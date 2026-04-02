#!/usr/bin/env python3
"""Reusable India transport data loader/cleaner for multimodal routing."""

from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path
from typing import Any

DEFAULT_DATA_DIR = (
    Path(__file__).resolve().parent / "Travel Planner" / "server" / "data" / "india"
)

QUALITY_RANK = {
    "high": 3,
    "medium": 2,
    "low": 1,
    "invalid": 0,
}


def _log(debug: bool, message: str, **context: object) -> None:
    if not debug:
        return
    if context:
        print(
            f"[transport-processor] {message} {json.dumps(context, sort_keys=True)}",
            file=sys.stderr,
            flush=True,
        )
        return
    print(f"[transport-processor] {message}", file=sys.stderr, flush=True)


def _normalize_text(value: object, fallback: str = "") -> str:
    if value is None:
        return fallback
    normalized = " ".join(str(value).strip().split())
    return normalized or fallback


def _to_float(value: object) -> float | None:
    if value in ("", None):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def _to_int(value: object) -> int | None:
    parsed = _to_float(value)
    if parsed is None:
        return None
    return int(round(parsed))


def _normalize_bool(value: object, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    text = _normalize_text(value).lower()
    if not text:
        return fallback
    return text in {"1", "true", "yes", "y"}


def _normalize_quality(value: object) -> str:
    quality = _normalize_text(value, "medium").lower()
    if quality not in QUALITY_RANK:
        return "medium"
    return quality


def _normalize_mode(value: object, fallback: str = "road") -> str:
    mode = _normalize_text(value).lower()
    if mode in {"flight", "train", "road"}:
        return mode

    if "flight" in mode or "air" in mode:
        return "flight"
    if "train" in mode or "rail" in mode:
        return "train"
    if "road" in mode or "bus" in mode or "drive" in mode:
        return "road"
    return fallback


def _normalize_submode(value: object, mode: str) -> str:
    submode = _normalize_text(value).lower().replace(" ", "_")
    if submode:
        return submode
    if mode == "flight":
        return "flight_standard"
    if mode == "road":
        return "road_intercity"
    return "standard"


def _normalize_availability(value: object) -> str:
    availability = _normalize_text(value, "unknown").lower()
    if availability in {"yes", "available", "true", "1"}:
        return "yes"
    if availability in {"no", "unavailable", "false", "0"}:
        return "no"
    return "unknown"


def _load_records(file_path: Path) -> list[dict[str, Any]]:
    suffix = file_path.suffix.lower()
    if suffix == ".json":
        payload = json.loads(file_path.read_text(encoding="utf8"))
        if not isinstance(payload, list):
            raise ValueError(f"Expected list payload in {file_path}")
        return [row for row in payload if isinstance(row, dict)]

    if suffix == ".csv":
        with file_path.open("r", encoding="utf8", newline="") as handle:
            reader = csv.DictReader(handle)
            return [dict(row) for row in reader]

    raise ValueError(f"Unsupported transport dataset format: {file_path}")


def _resolve_file_path(data_dir: Path, provided: str | Path | None, default_name: str) -> Path:
    if provided:
        return Path(provided).expanduser().resolve()
    return (data_dir / default_name).resolve()


def _route_sort_key(route: dict[str, Any]) -> tuple[int, int, float]:
    quality = QUALITY_RANK.get(_normalize_quality(route.get("source_quality")), 0)
    availability = _normalize_availability(route.get("availability_status"))
    availability_rank = 2 if availability == "yes" else 1 if availability == "unknown" else 0
    duration = _to_float(route.get("duration_minutes"))
    duration_score = duration if duration is not None and duration > 0 else float("inf")
    return (quality, availability_rank, -duration_score)


def _build_route_id(route: dict[str, Any]) -> str:
    existing = _normalize_text(route.get("route_id"))
    if existing:
        return existing
    return (
        f"route--{_normalize_text(route.get('source_city_id')).lower()}"
        f"--{_normalize_text(route.get('destination_city_id')).lower()}"
        f"--{_normalize_mode(route.get('mode'))}"
        f"--{_normalize_submode(route.get('submode'), _normalize_mode(route.get('mode')))}"
    )


def _sanitize_route(
    raw_route: dict[str, Any],
    valid_city_ids: set[str],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    source_city_id = _normalize_text(raw_route.get("source_city_id"))
    destination_city_id = _normalize_text(raw_route.get("destination_city_id"))

    if not source_city_id or not destination_city_id:
        return None, {
            "reason": "missing_city_id",
            "raw_route_key": _normalize_text(raw_route.get("raw_route_key")),
            "route_id": _normalize_text(raw_route.get("route_id")),
        }

    if source_city_id == destination_city_id:
        return None, {
            "reason": "self_loop",
            "source_city_id": source_city_id,
            "destination_city_id": destination_city_id,
            "route_id": _normalize_text(raw_route.get("route_id")),
        }

    if valid_city_ids and (
        source_city_id not in valid_city_ids or destination_city_id not in valid_city_ids
    ):
        return None, {
            "reason": "unknown_city_reference",
            "source_city_id": source_city_id,
            "destination_city_id": destination_city_id,
            "route_id": _normalize_text(raw_route.get("route_id")),
        }

    duration_minutes = _to_int(raw_route.get("duration_minutes"))
    if duration_minutes is None:
        duration_minutes = _to_int(raw_route.get("travel_time_minutes"))
    if duration_minutes is None and raw_route.get("travel_time_hr") is not None:
        hours = _to_float(raw_route.get("travel_time_hr"))
        duration_minutes = int(round(hours * 60)) if hours is not None else None

    if duration_minutes is None or duration_minutes <= 0:
        return None, {
            "reason": "invalid_duration",
            "source_city_id": source_city_id,
            "destination_city_id": destination_city_id,
            "route_id": _normalize_text(raw_route.get("route_id")),
            "duration_minutes": duration_minutes,
        }

    distance_km = _to_float(raw_route.get("distance_km"))
    if distance_km is None:
        distance_km = _to_float(raw_route.get("distance"))
    if distance_km is not None and distance_km <= 0:
        distance_km = None

    mode = _normalize_mode(raw_route.get("mode"))
    route = {
        "route_id": _build_route_id(raw_route),
        "source_city_id": source_city_id,
        "destination_city_id": destination_city_id,
        "mode": mode,
        "submode": _normalize_submode(raw_route.get("submode"), mode),
        "distance_km": distance_km,
        "duration_minutes": duration_minutes,
        "availability_status": _normalize_availability(
            raw_route.get("availability_status", raw_route.get("availability"))
        ),
        "cost_general": _to_float(raw_route.get("cost_general")),
        "cost_sleeper": _to_float(raw_route.get("cost_sleeper")),
        "cost_ac3": _to_float(raw_route.get("cost_ac3")),
        "cost_ac2": _to_float(raw_route.get("cost_ac2")),
        "cost_ac1": _to_float(raw_route.get("cost_ac1")),
        "cost_is_estimated": _normalize_bool(raw_route.get("cost_is_estimated"), False),
        "source_dataset": _normalize_text(raw_route.get("source_dataset")),
        "source_quality": _normalize_quality(raw_route.get("source_quality")),
        "raw_route_key": _normalize_text(
            raw_route.get("raw_route_key"),
            f"{source_city_id}->{destination_city_id}",
        ),
    }
    return route, None


def _sanitize_city(raw_city: dict[str, Any]) -> dict[str, Any] | None:
    city_id = _normalize_text(raw_city.get("city_id"))
    canonical_name = _normalize_text(raw_city.get("canonical_name"))
    if not city_id or not canonical_name:
        return None

    return {
        "city_id": city_id,
        "canonical_name": canonical_name,
        "state_ut_name": _normalize_text(raw_city.get("state_ut_name")),
        "latitude": _to_float(raw_city.get("latitude")),
        "longitude": _to_float(raw_city.get("longitude")),
        "aliases": [
            alias
            for alias in (
                _normalize_text(alias)
                for alias in (
                    raw_city.get("aliases", []) if isinstance(raw_city.get("aliases"), list) else []
                )
            )
            if alias
        ],
        "has_flight": _normalize_bool(raw_city.get("has_flight"), False),
        "has_train": _normalize_bool(raw_city.get("has_train"), False),
        "has_road": _normalize_bool(raw_city.get("has_road"), False),
    }


def _sanitize_hub(raw_hub: dict[str, Any], valid_city_ids: set[str]) -> dict[str, Any] | None:
    destination_id = _normalize_text(raw_hub.get("destination_id"))
    city_id = _normalize_text(raw_hub.get("city_id"))
    if not destination_id or not city_id:
        return None
    if valid_city_ids and city_id not in valid_city_ids:
        return None

    return {
        "destination_id": destination_id,
        "city_id": city_id,
        "hub_rank": _to_int(raw_hub.get("hub_rank")) or 1,
        "access_distance_km": _to_float(raw_hub.get("access_distance_km")),
        "access_duration_minutes": _to_int(raw_hub.get("access_duration_minutes")),
        "matching_method": _normalize_text(raw_hub.get("matching_method"), "unknown"),
    }


def load_transport_graph_data(
    *,
    data_dir: str | Path | None = None,
    cities_path: str | Path | None = None,
    routes_path: str | Path | None = None,
    hubs_path: str | Path | None = None,
    city_rows: list[dict[str, Any]] | None = None,
    route_rows: list[dict[str, Any]] | None = None,
    hub_rows: list[dict[str, Any]] | None = None,
    debug: bool = False,
) -> dict[str, Any]:
    """Load and normalize the transport graph for multimodal optimization."""

    resolved_data_dir = Path(data_dir).expanduser().resolve() if data_dir else DEFAULT_DATA_DIR
    resolved_cities_path = _resolve_file_path(
        resolved_data_dir, cities_path, "india_transport_cities.json"
    )
    resolved_routes_path = _resolve_file_path(
        resolved_data_dir, routes_path, "india_transport_routes.json"
    )
    resolved_hubs_path = _resolve_file_path(
        resolved_data_dir, hubs_path, "india_destination_hubs.json"
    )

    raw_cities = city_rows if city_rows is not None else _load_records(resolved_cities_path)
    raw_routes = route_rows if route_rows is not None else _load_records(resolved_routes_path)
    raw_hubs = hub_rows if hub_rows is not None else _load_records(resolved_hubs_path)

    cities = [city for city in (_sanitize_city(row) for row in raw_cities) if city is not None]
    valid_city_ids = {city["city_id"] for city in cities}
    city_by_id = {city["city_id"]: city for city in cities}

    deduped_route_by_key: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    quarantined_routes: list[dict[str, Any]] = []
    duplicate_count = 0

    for raw_route in raw_routes:
        route, quarantine = _sanitize_route(raw_route, valid_city_ids)
        if quarantine:
            quarantined_routes.append(quarantine)
            continue

        route_key = (
            route["source_city_id"],
            route["destination_city_id"],
            route["mode"],
            route["submode"],
        )
        existing = deduped_route_by_key.get(route_key)
        if existing is None:
            deduped_route_by_key[route_key] = route
            continue

        duplicate_count += 1
        if _route_sort_key(route) > _route_sort_key(existing):
            quarantined_routes.append(
                {
                    "reason": "duplicate_superseded",
                    "route_id": existing.get("route_id", ""),
                    "raw_route_key": existing.get("raw_route_key", ""),
                    "source_city_id": existing.get("source_city_id", ""),
                    "destination_city_id": existing.get("destination_city_id", ""),
                }
            )
            deduped_route_by_key[route_key] = route
        else:
            quarantined_routes.append(
                {
                    "reason": "duplicate_dropped",
                    "route_id": route.get("route_id", ""),
                    "raw_route_key": route.get("raw_route_key", ""),
                    "source_city_id": route.get("source_city_id", ""),
                    "destination_city_id": route.get("destination_city_id", ""),
                }
            )

    routes = sorted(
        deduped_route_by_key.values(),
        key=lambda route: (
            route["source_city_id"],
            route["destination_city_id"],
            route["mode"],
            route["submode"],
            route["duration_minutes"],
        ),
    )

    destination_hubs = [
        hub
        for hub in (_sanitize_hub(row, valid_city_ids) for row in raw_hubs)
        if hub is not None
    ]
    destination_hubs.sort(
        key=lambda hub: (hub["destination_id"], hub["hub_rank"], hub["city_id"])
    )

    modes = sorted({route["mode"] for route in routes})
    metrics = {
        "city_count": len(cities),
        "route_count": len(routes),
        "hub_count": len(destination_hubs),
        "quarantined_route_count": len(quarantined_routes),
        "duplicate_route_count": duplicate_count,
        "modes": modes,
    }

    _log(
        debug,
        "Normalized transport graph",
        data_dir=str(resolved_data_dir),
        cities_path=str(resolved_cities_path),
        routes_path=str(resolved_routes_path),
        hubs_path=str(resolved_hubs_path),
        **metrics,
    )

    return {
        "cities": cities,
        "city_by_id": city_by_id,
        "routes": routes,
        "destination_hubs": destination_hubs,
        "quarantined_routes": quarantined_routes,
        "metrics": metrics,
    }


def _load_payload_from_stdin() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    payload = json.loads(raw)
    return payload if isinstance(payload, dict) else {}


def main() -> None:
    payload = _load_payload_from_stdin()
    debug = _normalize_bool(payload.get("debug"), False)

    result = load_transport_graph_data(
        data_dir=payload.get("dataDir"),
        cities_path=payload.get("citiesPath"),
        routes_path=payload.get("routesPath"),
        hubs_path=payload.get("hubsPath"),
        city_rows=payload.get("cityRows"),
        route_rows=payload.get("routeRows"),
        hub_rows=payload.get("hubRows"),
        debug=debug,
    )
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
