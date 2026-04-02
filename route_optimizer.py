#!/usr/bin/env python3
"""Route optimization engine.

Supports:
1) Matrix optimization for intra-destination sequencing (legacy behavior).
2) Directed multimodal intercity optimization over India transport routes.
"""

from __future__ import annotations

import heapq
import json
import math
import sys
from typing import Any

from transport_data_processor import load_transport_graph_data

QUALITY_RANK = {
    "invalid": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
}

RANK_TO_QUALITY = {
    0: "invalid",
    1: "low",
    2: "medium",
    3: "high",
}


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


def _to_int(value: object, fallback: int | None = None) -> int | None:
    parsed = _to_float(value)
    if parsed is None:
        return fallback
    return int(round(parsed))


def _normalize_bool(value: object, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    text = _normalize_text(value).lower()
    if not text:
        return fallback
    return text in {"1", "true", "yes", "y"}


def _normalize_mode(value: object) -> str:
    mode = _normalize_text(value).lower()
    if mode in {"flight", "train", "road"}:
        return mode
    if "flight" in mode or "air" in mode:
        return "flight"
    if "train" in mode or "rail" in mode:
        return "train"
    if "road" in mode or "bus" in mode or "drive" in mode:
        return "road"
    return mode


def _normalize_availability(value: object) -> str:
    availability = _normalize_text(value, "unknown").lower()
    if availability in {"yes", "available", "true", "1"}:
        return "yes"
    if availability in {"no", "unavailable", "false", "0"}:
        return "no"
    return "unknown"


def _normalize_quality(value: object) -> str:
    quality = _normalize_text(value, "medium").lower()
    if quality not in QUALITY_RANK:
        return "medium"
    return quality


def _parse_mode_list(values: Any) -> set[str]:
    if not isinstance(values, list):
        return set()
    normalized = set()
    for value in values:
        mode = _normalize_mode(value)
        if mode in {"flight", "train", "road"}:
            normalized.add(mode)
    return normalized


def _sum_numeric_or_none(segments: list[dict[str, Any]], key: str) -> float | None:
    total = 0.0
    has_value = False
    for segment in segments:
        value = _to_float(segment.get(key))
        if value is None:
            return None
        total += value
        has_value = True
    if not has_value:
        return None
    return round(total, 2)


def _extract_destination_hub_map(destination_hubs: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(destination_hubs, list):
        return {}
    hub_by_city_id: dict[str, dict[str, Any]] = {}
    for hub in destination_hubs:
        if not isinstance(hub, dict):
            continue
        city_id = _normalize_text(hub.get("city_id"))
        if not city_id:
            continue
        existing = hub_by_city_id.get(city_id)
        candidate_rank = _to_int(hub.get("hub_rank"), 999) or 999
        existing_rank = _to_int(existing.get("hub_rank"), 999) if isinstance(existing, dict) else 999
        if existing is None or candidate_rank < existing_rank:
            hub_by_city_id[city_id] = {
                "destination_id": _normalize_text(hub.get("destination_id")),
                "city_id": city_id,
                "hub_rank": candidate_rank,
                "access_distance_km": _to_float(hub.get("access_distance_km")),
                "access_duration_minutes": _to_int(hub.get("access_duration_minutes")),
                "matching_method": _normalize_text(hub.get("matching_method"), "unknown"),
            }
    return hub_by_city_id


def _build_multimodal_graph(payload: dict[str, Any]) -> dict[str, Any]:
    routes = payload.get("routes")
    cities = payload.get("cities")
    destination_hubs = payload.get("destinationHubs")
    if not isinstance(routes, list) or not isinstance(cities, list):
        processed = load_transport_graph_data(
            data_dir=payload.get("dataDir"),
            routes_path=payload.get("routesPath"),
            cities_path=payload.get("citiesPath"),
            hubs_path=payload.get("hubsPath"),
            route_rows=routes if isinstance(routes, list) else None,
            city_rows=cities if isinstance(cities, list) else None,
            hub_rows=destination_hubs if isinstance(destination_hubs, list) else None,
            debug=_normalize_bool(payload.get("debug"), False),
        )
        routes = processed["routes"]
        cities = processed["cities"]
        destination_hubs = processed["destination_hubs"]
    else:
        processed = {
            "metrics": {
                "route_count": len(routes),
                "city_count": len(cities),
                "hub_count": len(destination_hubs) if isinstance(destination_hubs, list) else 0,
            }
        }

    city_by_id: dict[str, dict[str, Any]] = {}
    for city in cities:
        if not isinstance(city, dict):
            continue
        city_id = _normalize_text(city.get("city_id"))
        if not city_id:
            continue
        city_by_id[city_id] = city

    adjacency: dict[str, list[dict[str, Any]]] = {}
    for route in routes:
        if not isinstance(route, dict):
            continue
        source_city_id = _normalize_text(route.get("source_city_id"))
        destination_city_id = _normalize_text(route.get("destination_city_id"))
        if not source_city_id or not destination_city_id:
            continue
        if source_city_id == destination_city_id:
            continue

        duration_minutes = _to_int(route.get("duration_minutes"))
        if duration_minutes is None or duration_minutes <= 0:
            continue

        edge = {
            "route_id": _normalize_text(route.get("route_id")),
            "source_city_id": source_city_id,
            "destination_city_id": destination_city_id,
            "mode": _normalize_mode(route.get("mode")),
            "submode": _normalize_text(route.get("submode")),
            "duration_minutes": duration_minutes,
            "distance_km": _to_float(route.get("distance_km")),
            "availability_status": _normalize_availability(route.get("availability_status")),
            "cost_general": _to_float(route.get("cost_general")),
            "cost_sleeper": _to_float(route.get("cost_sleeper")),
            "cost_ac3": _to_float(route.get("cost_ac3")),
            "cost_ac2": _to_float(route.get("cost_ac2")),
            "cost_ac1": _to_float(route.get("cost_ac1")),
            "cost_is_estimated": _normalize_bool(route.get("cost_is_estimated"), False),
            "source_dataset": _normalize_text(route.get("source_dataset")),
            "source_quality": _normalize_quality(route.get("source_quality")),
            "raw_route_key": _normalize_text(route.get("raw_route_key")),
        }
        adjacency.setdefault(source_city_id, []).append(edge)

    return {
        "processed_metrics": processed.get("metrics", {}),
        "city_by_id": city_by_id,
        "adjacency": adjacency,
        "destination_hub_by_city_id": _extract_destination_hub_map(destination_hubs),
    }


def _dijkstra_multimodal(
    *,
    adjacency: dict[str, list[dict[str, Any]]],
    origin_city_id: str,
    destination_city_ids: set[str],
    max_transfers: int,
    top_k: int,
    preferred_modes: set[str],
    include_unavailable: bool,
) -> tuple[list[dict[str, Any]], list[str]]:
    max_segments = max(1, max_transfers + 1)
    preferred_mode_fallback_used = False

    def run_with_mode_filter(mode_filter: set[str]) -> list[dict[str, Any]]:
        state_counter = 0
        states: dict[int, dict[str, Any]] = {
            0: {
                "city_id": origin_city_id,
                "total_duration": 0,
                "total_distance": 0.0,
                "segment_count": 0,
                "prev_state_id": None,
                "edge": None,
            }
        }
        # (duration, transfers, distance, state_id)
        heap: list[tuple[float, int, float, int]] = [(0.0, 0, 0.0, 0)]
        best_cost_by_city_and_segments: dict[tuple[str, int], tuple[float, int, float]] = {
            (origin_city_id, 0): (0.0, 0, 0.0)
        }
        destination_states: list[int] = []

        while heap:
            current_duration, current_transfers, current_distance, state_id = heapq.heappop(heap)
            state = states[state_id]
            city_id = state["city_id"]
            segment_count = state["segment_count"]
            best_cost = best_cost_by_city_and_segments.get((city_id, segment_count))
            if best_cost is None:
                continue
            if (current_duration, current_transfers, current_distance) > best_cost:
                continue

            if city_id in destination_city_ids and segment_count > 0:
                destination_states.append(state_id)
                if len(destination_states) >= top_k:
                    # Continue searching for potentially better alternatives
                    # with same destination and fewer transfers/distance.
                    pass

            if segment_count >= max_segments:
                continue

            for edge in adjacency.get(city_id, []):
                mode = _normalize_mode(edge.get("mode"))
                if mode_filter and mode not in mode_filter:
                    continue
                availability_status = _normalize_availability(edge.get("availability_status"))
                if not include_unavailable and availability_status == "no":
                    continue

                next_city_id = _normalize_text(edge.get("destination_city_id"))
                duration_minutes = _to_int(edge.get("duration_minutes"))
                if not next_city_id or duration_minutes is None or duration_minutes <= 0:
                    continue

                next_segment_count = segment_count + 1
                next_transfers = max(0, next_segment_count - 1)
                next_duration = current_duration + duration_minutes
                next_distance = current_distance + (_to_float(edge.get("distance_km")) or 0.0)

                best_for_next = best_cost_by_city_and_segments.get(
                    (next_city_id, next_segment_count)
                )
                next_cost_tuple = (next_duration, next_transfers, next_distance)
                if best_for_next is not None and next_cost_tuple >= best_for_next:
                    continue

                state_counter += 1
                states[state_counter] = {
                    "city_id": next_city_id,
                    "total_duration": next_duration,
                    "total_distance": next_distance,
                    "segment_count": next_segment_count,
                    "prev_state_id": state_id,
                    "edge": edge,
                }
                best_cost_by_city_and_segments[(next_city_id, next_segment_count)] = next_cost_tuple
                heapq.heappush(
                    heap,
                    (next_duration, next_transfers, next_distance, state_counter),
                )

        results: list[dict[str, Any]] = []
        for destination_state_id in destination_states:
            cursor = destination_state_id
            edges: list[dict[str, Any]] = []
            while cursor is not None:
                state = states[cursor]
                edge = state.get("edge")
                if edge is not None:
                    edges.append(edge)
                cursor = state.get("prev_state_id")
            edges.reverse()
            if not edges:
                continue
            results.append(
                {
                    "edges": edges,
                    "total_duration_minutes": int(round(states[destination_state_id]["total_duration"])),
                    "total_distance_km": round(float(states[destination_state_id]["total_distance"]), 2),
                    "transfer_count": max(0, len(edges) - 1),
                    "segment_count": len(edges),
                    "destination_city_id": _normalize_text(
                        states[destination_state_id]["city_id"]
                    ),
                }
            )

        results.sort(
            key=lambda item: (
                item["total_duration_minutes"],
                item["transfer_count"],
                item["total_distance_km"],
            )
        )
        return results

    candidate_paths = run_with_mode_filter(preferred_modes)
    notes: list[str] = []
    if preferred_modes and not candidate_paths:
        preferred_mode_fallback_used = True
        notes.append(
            "Preferred modes had no feasible path. Falling back to all available modes."
        )
        candidate_paths = run_with_mode_filter(set())

    if preferred_mode_fallback_used:
        notes.append("Fallback mode search was used to keep routing feasible.")
    return candidate_paths[: max(1, top_k)], notes


def _aggregate_option(
    option_index: int,
    candidate: dict[str, Any],
    city_by_id: dict[str, dict[str, Any]],
    destination_hub_by_city_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    segments: list[dict[str, Any]] = []
    availability_rank = 2
    worst_quality_rank = 3
    mode_mix: list[str] = []
    source_datasets: list[str] = []

    for segment_index, edge in enumerate(candidate["edges"], start=1):
        mode = _normalize_mode(edge.get("mode"))
        if mode and mode not in mode_mix:
            mode_mix.append(mode)

        source_dataset = _normalize_text(edge.get("source_dataset"))
        if source_dataset and source_dataset not in source_datasets:
            source_datasets.append(source_dataset)

        availability = _normalize_availability(edge.get("availability_status"))
        if availability == "no":
            availability_rank = min(availability_rank, 0)
        elif availability == "unknown":
            availability_rank = min(availability_rank, 1)

        quality_rank = QUALITY_RANK.get(_normalize_quality(edge.get("source_quality")), 2)
        worst_quality_rank = min(worst_quality_rank, quality_rank)

        source_city_id = _normalize_text(edge.get("source_city_id"))
        destination_city_id = _normalize_text(edge.get("destination_city_id"))
        source_city_name = _normalize_text(
            city_by_id.get(source_city_id, {}).get("canonical_name"),
            source_city_id,
        )
        destination_city_name = _normalize_text(
            city_by_id.get(destination_city_id, {}).get("canonical_name"),
            destination_city_id,
        )

        segments.append(
            {
                "segment_index": segment_index,
                "route_id": _normalize_text(edge.get("route_id")),
                "source_city_id": source_city_id,
                "source_city_name": source_city_name,
                "destination_city_id": destination_city_id,
                "destination_city_name": destination_city_name,
                "mode": mode,
                "submode": _normalize_text(edge.get("submode")),
                "duration_minutes": _to_int(edge.get("duration_minutes"), 0) or 0,
                "distance_km": _to_float(edge.get("distance_km")),
                "availability_status": availability,
                "cost_general": _to_float(edge.get("cost_general")),
                "cost_sleeper": _to_float(edge.get("cost_sleeper")),
                "cost_ac3": _to_float(edge.get("cost_ac3")),
                "cost_ac2": _to_float(edge.get("cost_ac2")),
                "cost_ac1": _to_float(edge.get("cost_ac1")),
                "cost_is_estimated": _normalize_bool(edge.get("cost_is_estimated"), False),
                "source_dataset": source_dataset,
                "source_quality": _normalize_quality(edge.get("source_quality")),
            }
        )

    destination_city_id = _normalize_text(candidate.get("destination_city_id"))
    destination_city_name = _normalize_text(
        city_by_id.get(destination_city_id, {}).get("canonical_name"),
        destination_city_id,
    )
    availability_status = "yes" if availability_rank == 2 else "unknown" if availability_rank == 1 else "no"

    return {
        "option_id": f"option-{option_index}",
        "destination_city_id": destination_city_id,
        "destination_city_name": destination_city_name,
        "total_duration_minutes": int(candidate["total_duration_minutes"]),
        "total_distance_km": _to_float(candidate.get("total_distance_km")),
        "transfer_count": int(candidate["transfer_count"]),
        "segment_count": int(candidate["segment_count"]),
        "mode_mix": mode_mix,
        "availability_status": availability_status,
        "cost_general": _sum_numeric_or_none(segments, "cost_general"),
        "cost_sleeper": _sum_numeric_or_none(segments, "cost_sleeper"),
        "cost_ac3": _sum_numeric_or_none(segments, "cost_ac3"),
        "cost_ac2": _sum_numeric_or_none(segments, "cost_ac2"),
        "cost_ac1": _sum_numeric_or_none(segments, "cost_ac1"),
        "cost_is_estimated": any(_normalize_bool(segment.get("cost_is_estimated")) for segment in segments),
        "source_quality": RANK_TO_QUALITY.get(worst_quality_rank, "medium"),
        "source_datasets": source_datasets,
        "segments": segments,
        "last_mile": destination_hub_by_city_id.get(destination_city_id),
    }


def optimize_multimodal(payload: dict[str, Any]) -> dict[str, Any]:
    graph = _build_multimodal_graph(payload)
    city_by_id = graph["city_by_id"]
    adjacency = graph["adjacency"]
    destination_hub_by_city_id = graph["destination_hub_by_city_id"]

    origin_city_id = _normalize_text(payload.get("originCityId"))
    if not origin_city_id:
        raise ValueError("originCityId is required for multimodal optimization")
    if origin_city_id not in city_by_id:
        raise ValueError("originCityId does not exist in the transport graph")

    destination_city_ids_input = payload.get("destinationCityIds")
    if not isinstance(destination_city_ids_input, list) or not destination_city_ids_input:
        raise ValueError("destinationCityIds must contain at least one destination city id")
    destination_city_ids = {
        _normalize_text(value) for value in destination_city_ids_input if _normalize_text(value)
    }
    if not destination_city_ids:
        raise ValueError("destinationCityIds must contain at least one valid destination city id")

    preferred_modes = _parse_mode_list(payload.get("preferredModes"))
    max_transfers = _to_int(payload.get("maxTransfers"), 4) or 4
    top_k = _to_int(payload.get("topK"), 4) or 4
    include_unavailable = _normalize_bool(payload.get("includeUnavailable"), False)

    candidates, notes = _dijkstra_multimodal(
        adjacency=adjacency,
        origin_city_id=origin_city_id,
        destination_city_ids=destination_city_ids,
        max_transfers=max(0, max_transfers),
        top_k=max(1, top_k),
        preferred_modes=preferred_modes,
        include_unavailable=include_unavailable,
    )

    options = []
    seen_signatures: set[str] = set()
    for index, candidate in enumerate(candidates, start=1):
        option = _aggregate_option(index, candidate, city_by_id, destination_hub_by_city_id)
        route_signature = "|".join(
            _normalize_text(segment.get("route_id")) for segment in option["segments"]
        )
        if route_signature and route_signature in seen_signatures:
            continue
        if route_signature:
            seen_signatures.add(route_signature)
        options.append(option)

    return {
        "algorithm": "python-multimodal-dijkstra-v2",
        "objective": _normalize_text(payload.get("objective"), "fastest_feasible"),
        "origin_city_id": origin_city_id,
        "origin_city_name": _normalize_text(city_by_id[origin_city_id].get("canonical_name"), origin_city_id),
        "destination_city_ids": sorted(destination_city_ids),
        "top_k": max(1, top_k),
        "max_transfers": max(0, max_transfers),
        "preferred_modes": sorted(preferred_modes),
        "transportOptions": options,
        "verification": {
            "status": "not_requested",
            "provider": "none",
            "confidence": 0.0,
            "notes": [
                "Deterministic shortest-path ranking applied on verified transport edges."
            ],
        },
        "notes": notes,
        "graphMetrics": graph["processed_metrics"],
    }


# -----------------------------
# Legacy matrix optimizer path
# -----------------------------


def _to_weight(value: object, row_index: int, column_index: int) -> float:
    if row_index == column_index:
        return 0.0
    numeric = _to_float(value)
    if numeric is None or numeric < 0:
        return math.inf
    return numeric


def normalize_weight_matrix(matrix: Any) -> list[list[float]]:
    normalized: list[list[float]] = []
    for row_index, row in enumerate(matrix or []):
        row_values = row if isinstance(row, list) else []
        normalized.append(
            [
                _to_weight(value, row_index, column_index)
                for column_index, value in enumerate(row_values)
            ]
        )
    return normalized


def dijkstra(weight_matrix: list[list[float]], start_index: int) -> dict[str, Any]:
    distances = [math.inf] * len(weight_matrix)
    previous: list[int | None] = [None] * len(weight_matrix)
    distances[start_index] = 0.0
    queue: list[tuple[float, int]] = [(0.0, start_index)]

    while queue:
        current_distance, current_index = heapq.heappop(queue)
        if current_distance > distances[current_index]:
            continue

        for neighbor_index, weight in enumerate(weight_matrix[current_index]):
            if not math.isfinite(weight) or neighbor_index == current_index:
                continue
            next_distance = current_distance + weight
            if next_distance >= distances[neighbor_index]:
                continue
            distances[neighbor_index] = next_distance
            previous[neighbor_index] = current_index
            heapq.heappush(queue, (next_distance, neighbor_index))

    return {
        "distances": [None if not math.isfinite(value) else value for value in distances],
        "previous": previous,
    }


def prim_mst(weight_matrix: list[list[float]]) -> dict[str, Any]:
    node_count = len(weight_matrix)
    if node_count == 0:
        return {"totalWeight": 0.0, "edges": []}

    visited = {0}
    edges = []
    total_weight = 0.0

    while len(visited) < node_count:
        best_edge = None
        for from_index in visited:
            for to_index, weight in enumerate(weight_matrix[from_index]):
                if to_index in visited or not math.isfinite(weight) or from_index == to_index:
                    continue
                if best_edge is None or weight < best_edge[2]:
                    best_edge = (from_index, to_index, weight)
        if best_edge is None:
            break
        from_index, to_index, weight = best_edge
        visited.add(to_index)
        total_weight += weight
        edges.append({"fromIndex": from_index, "toIndex": to_index, "weight": weight})

    return {"totalWeight": total_weight, "edges": edges}


def path_weight(weight_matrix: list[list[float]], order: list[int]) -> float:
    total = 0.0
    for index in range(len(order) - 1):
        from_index = order[index]
        to_index = order[index + 1]
        weight = weight_matrix[from_index][to_index]
        if not math.isfinite(weight):
            return math.inf
        total += weight
    return total


def nearest_neighbor_path(
    weight_matrix: list[list[float]],
    origin_index: int,
    destination_index: int | None = None,
) -> list[int]:
    node_count = len(weight_matrix)
    if node_count == 0:
        return []

    fixed_destination = (
        destination_index
        if destination_index is not None and 0 <= destination_index < node_count
        else None
    )
    unvisited = set(range(node_count))
    unvisited.discard(origin_index)
    if fixed_destination is not None and fixed_destination != origin_index:
        unvisited.discard(fixed_destination)

    order = [origin_index]
    current_index = origin_index
    while unvisited:
        next_index = min(
            unvisited,
            key=lambda candidate: weight_matrix[current_index][candidate],
        )
        order.append(next_index)
        unvisited.remove(next_index)
        current_index = next_index

    if fixed_destination is not None and fixed_destination != origin_index:
        order.append(fixed_destination)

    return order


def two_opt_path(
    weight_matrix: list[list[float]],
    order: list[int],
    *,
    fixed_start: bool = True,
    fixed_end: bool = True,
) -> list[int]:
    if len(order) < 4:
        return order

    best_order = list(order)
    best_weight = path_weight(weight_matrix, best_order)
    if not math.isfinite(best_weight):
        return order

    start_offset = 1 if fixed_start else 0
    end_offset = len(best_order) - 2 if fixed_end else len(best_order) - 1
    improved = True
    while improved:
        improved = False
        for left_index in range(start_offset, end_offset):
            for right_index in range(left_index + 1, len(best_order) - (1 if fixed_end else 0)):
                candidate = (
                    best_order[:left_index]
                    + list(reversed(best_order[left_index : right_index + 1]))
                    + best_order[right_index + 1 :]
                )
                candidate_weight = path_weight(weight_matrix, candidate)
                if candidate_weight + 1e-9 >= best_weight:
                    continue
                best_order = candidate
                best_weight = candidate_weight
                improved = True

    return best_order


def _normalize_coordinate(value: object) -> tuple[float, float] | None:
    if not isinstance(value, dict):
        return None
    latitude = _to_float(value.get("latitude", value.get("lat")))
    longitude = _to_float(value.get("longitude", value.get("lng")))
    if latitude is None or longitude is None:
        return None
    return (latitude, longitude)


def _squared_distance(left: tuple[float, float] | None, right: tuple[float, float] | None) -> float:
    if left is None or right is None:
        return math.inf
    latitude_delta = left[0] - right[0]
    longitude_delta = left[1] - right[1]
    return latitude_delta * latitude_delta + longitude_delta * longitude_delta


def cluster_coordinates(node_coordinates: list[dict[str, Any]], cluster_count: int) -> tuple[dict[int, int], list[tuple[float, float]]]:
    coordinates = [_normalize_coordinate(item) for item in node_coordinates]
    node_count = len(coordinates)
    if node_count == 0:
        return {}, []
    if cluster_count <= 1:
        return {index: 0 for index in range(node_count)}, [coordinates[0] or (0.0, 0.0)]

    valid_indices = [index for index, coordinate in enumerate(coordinates) if coordinate is not None]
    if not valid_indices:
        return {index: index % cluster_count for index in range(node_count)}, []

    cluster_count = max(1, min(cluster_count, len(valid_indices)))
    stride = max(1, len(valid_indices) // cluster_count)
    centroid_indices = [
        valid_indices[min(index * stride, len(valid_indices) - 1)] for index in range(cluster_count)
    ]
    centroids = [coordinates[index] for index in centroid_indices]
    assignments: dict[int, int] = {}

    for _ in range(24):
        next_assignments: dict[int, int] = {}
        for node_index, coordinate in enumerate(coordinates):
            if coordinate is None:
                next_assignments[node_index] = node_index % cluster_count
                continue
            best_cluster_id = min(
                range(cluster_count),
                key=lambda cluster_id: _squared_distance(coordinate, centroids[cluster_id]),
            )
            next_assignments[node_index] = best_cluster_id

        if next_assignments == assignments:
            break

        assignments = next_assignments
        cluster_buckets: dict[int, list[tuple[float, float]]] = {
            cluster_id: [] for cluster_id in range(cluster_count)
        }
        for node_index, cluster_id in assignments.items():
            coordinate = coordinates[node_index]
            if coordinate is None:
                continue
            cluster_buckets[cluster_id].append(coordinate)

        next_centroids: list[tuple[float, float]] = []
        for cluster_id in range(cluster_count):
            bucket = cluster_buckets[cluster_id]
            if not bucket:
                next_centroids.append(centroids[cluster_id] or (0.0, 0.0))
                continue
            latitude_mean = sum(item[0] for item in bucket) / len(bucket)
            longitude_mean = sum(item[1] for item in bucket) / len(bucket)
            next_centroids.append((latitude_mean, longitude_mean))
        centroids = next_centroids

    if not assignments:
        assignments = {index: index % cluster_count for index in range(node_count)}

    return assignments, centroids


def build_clusters(assignments: dict[int, int], cluster_count: int) -> list[dict[str, Any]]:
    if cluster_count <= 0:
        return []
    clusters = []
    for cluster_id in range(cluster_count):
        members = sorted(
            [node_index for node_index, assigned_cluster_id in assignments.items() if assigned_cluster_id == cluster_id]
        )
        clusters.append({"clusterId": cluster_id, "members": members})
    return clusters


def build_day_plans(visit_order: list[int], assignments: dict[int, int], cluster_count: int) -> list[dict[str, Any]]:
    if cluster_count <= 0:
        return []
    day_plans = []
    for cluster_id in range(cluster_count):
        cluster_visit_order = [node_index for node_index in visit_order if assignments.get(node_index) == cluster_id]
        if not cluster_visit_order:
            continue
        day_plans.append(
            {
                "day": len(day_plans) + 1,
                "clusterId": cluster_id,
                "visitOrder": cluster_visit_order,
                "stopCount": len(cluster_visit_order),
            }
        )
    if not day_plans and visit_order:
        day_plans.append(
            {
                "day": 1,
                "clusterId": 0,
                "visitOrder": visit_order,
                "stopCount": len(visit_order),
            }
        )
    return day_plans


def optimize_matrix(payload: dict[str, Any]) -> dict[str, Any]:
    weight_matrix = normalize_weight_matrix(payload.get("matrix", []))
    if not weight_matrix:
        raise ValueError("matrix is required")

    origin_index = int(payload.get("originIndex", 0))
    destination_index = payload.get("destinationIndex")
    destination_index = int(destination_index) if destination_index is not None else None
    if origin_index < 0 or origin_index >= len(weight_matrix):
        raise ValueError("originIndex is out of bounds")

    initial_order = nearest_neighbor_path(
        weight_matrix,
        origin_index=origin_index,
        destination_index=destination_index,
    )
    optimized_order = two_opt_path(
        weight_matrix,
        initial_order,
        fixed_start=True,
        fixed_end=destination_index is not None and destination_index != origin_index,
    )

    raw_cluster_count = payload.get("clusterCount", 1)
    try:
        cluster_count = int(raw_cluster_count)
    except (TypeError, ValueError):
        cluster_count = 1

    node_coordinates = payload.get("nodeCoordinates", [])
    assignments, _ = cluster_coordinates(node_coordinates, cluster_count)
    clusters = build_clusters(assignments, max(1, cluster_count))
    day_plans = build_day_plans(optimized_order, assignments, max(1, cluster_count))
    shortest_paths = dijkstra(weight_matrix, origin_index)
    mst = prim_mst(weight_matrix)

    return {
        "algorithm": "python-nearest-neighbor-2opt",
        "visitOrder": optimized_order,
        "totalWeight": path_weight(weight_matrix, optimized_order),
        "shortestPathsFromOrigin": shortest_paths["distances"],
        "previous": shortest_paths["previous"],
        "mst": mst,
        "clusters": clusters,
        "clusterAssignments": assignments,
        "dayPlans": day_plans,
    }


def optimize_route(payload: dict[str, Any]) -> dict[str, Any]:
    mode = _normalize_text(payload.get("mode"), "matrix").lower()
    if mode in {"multimodal", "transport"}:
        return optimize_multimodal(payload)
    return optimize_matrix(payload)


def main() -> None:
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError("Input payload must be a JSON object")
    result = optimize_route(payload)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # pragma: no cover - CLI surface
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
