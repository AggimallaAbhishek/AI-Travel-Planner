#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import ssl
import time
import unicodedata
import urllib.parse
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from zipfile import ZipFile

INCREDIBLE_INDIA_LISTING_URL = "https://www.incredibleindia.gov.in/en/trips/trip-listing"
INCREDIBLE_INDIA_BASE_URL = "https://www.incredibleindia.gov.in"
WIKIDATA_SEARCH_URL = "https://www.wikidata.org/w/api.php"
WIKIDATA_ENTITY_URL = "https://www.wikidata.org/wiki/Special:EntityData/{entity_id}.json"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
HTTP_USER_AGENT = "Codex India Travel Data Builder/1.0 (research use)"
NOMINATIM_USER_AGENT = "Codex India Travel Data Builder/1.0 (contact: local-dev)"
REQUEST_TIMEOUT_SECONDS = 30
OFFICIAL_SITE_REQUEST_DELAY_SECONDS = 0.08
WIKIDATA_REQUEST_DELAY_SECONDS = 0.08
NOMINATIM_REQUEST_DELAY_SECONDS = 1.05
TOP_ATTRACTIONS_PER_DESTINATION = 10
FEATURED_DESTINATION_LIMIT = 12
DEFAULT_COUNTRY_CODE = "IN"
INVALID_TRANSPORT_CITY_LABEL = "(City varies; often used for smaller town strips)"

FEATURED_DESTINATION_IMAGE_OVERRIDES = {
  "visakhapatnam": "https://commons.wikimedia.org/wiki/Special:FilePath/Visakhapatnam%202010.jpg?width=1400",
  "vijayapura": "https://commons.wikimedia.org/wiki/Special:FilePath/Gol%20Gumbaz%20main%20view.jpg?width=1400",
  "varanasi": "https://commons.wikimedia.org/wiki/Special:FilePath/Varanasi%20ghat.jpg?width=1400",
  "udaipur": "https://commons.wikimedia.org/wiki/Special:FilePath/LAKE%20PALACE%20UDAIPUR.jpg?width=1400",
  "thiruvananthapuram": "https://commons.wikimedia.org/wiki/Special:FilePath/Thiruvananthapuram%20City%20view.jpg?width=1400",
  "tezpur": "https://commons.wikimedia.org/wiki/Special:FilePath/Koliabhomora%20Setu.jpg?width=1400",
  "tawang": "https://commons.wikimedia.org/wiki/Special:FilePath/Tawang.jpg?width=1400",
  "srinagar": "https://commons.wikimedia.org/wiki/Special:FilePath/Srinagar%20-%20Dal%20lake%20and%20around%2048.JPG?width=1400",
  "sri-vijaya-puram": "https://commons.wikimedia.org/wiki/Special:FilePath/Port%20blair1.jpg?width=1400",
  "silvassa": "https://commons.wikimedia.org/wiki/Special:FilePath/A%20Beautiful%20Nature%20of%20Silvassa.jpg?width=1400",
  "shimla": "https://commons.wikimedia.org/wiki/Special:FilePath/Shimla%20Southern%20Side%20of%20Ridge.JPG?width=1400",
  "shillong": "https://commons.wikimedia.org/wiki/Special:FilePath/Shillong%2C%20India.jpg?width=1400",
}

STATE_SLUG_NAME_MAP = {
  "andaman-and-nicobar-islands": "Andaman and Nicobar Islands",
  "andhra-pradesh": "Andhra Pradesh",
  "arunachal-pradesh": "Arunachal Pradesh",
  "assam": "Assam",
  "bihar": "Bihar",
  "chandigarh": "Chandigarh",
  "chhattisgarh": "Chhattisgarh",
  "dadra-and-nagar-haveli-and-daman-and-diu": "Dadra and Nagar Haveli and Daman and Diu",
  "delhi": "Delhi",
  "goa": "Goa",
  "gujarat": "Gujarat",
  "haryana": "Haryana",
  "himachal-pradesh": "Himachal Pradesh",
  "jammu-and-kashmir": "Jammu and Kashmir",
  "jharkhand": "Jharkhand",
  "karnataka": "Karnataka",
  "kerala": "Kerala",
  "ladakh": "Ladakh",
  "lakshadweep": "Lakshadweep",
  "madhya-pradesh": "Madhya Pradesh",
  "maharashtra": "Maharashtra",
  "manipur": "Manipur",
  "meghalaya": "Meghalaya",
  "mizoram": "Mizoram",
  "nagaland": "Nagaland",
  "odisha": "Odisha",
  "puducherry": "Puducherry",
  "punjab": "Punjab",
  "rajasthan": "Rajasthan",
  "sikkim": "Sikkim",
  "tamil-nadu": "Tamil Nadu",
  "telangana": "Telangana",
  "tripura": "Tripura",
  "uttar-pradesh": "Uttar Pradesh",
  "uttarakhand": "Uttarakhand",
  "west-bengal": "West Bengal",
}

EXCLUDED_LISTING_SLUGS = {
  "account",
  "bookmarks",
  "colours-of-india",
  "contact-us",
  "content-hub",
  "experiences",
  "faqs",
  "festivals-and-events",
  "people-and-culture",
  "privacy-policy",
  "terms-of-use",
  "travel-for-life",
  "trips",
  "attractions",
}

CITY_ALIAS_SEEDS = {
  "agatti island (lakshadweep)": "Agatti Island",
  "belagavi (belgaum)": "Belagavi",
  "dabolim (vasco da gama)": "Vasco da Gama",
  "hubballi (hubli)": "Hubballi",
  "kozhikode (calicut)": "Kozhikode",
  "mangaluru (mangalore)": "Mangaluru",
  "prayagraj (allahabad)": "Prayagraj",
  "new delhi": "Delhi",
  "bangalore": "Bengaluru",
  "trivandrum": "Thiruvananthapuram",
}

DESTINATION_ALIAS_SEEDS = {
  "new delhi": "Delhi",
  "agatti": "Agatti Island",
}

TOURISM_TAG_KEYWORDS = {
  "beach": "beach",
  "coast": "beach",
  "island": "island",
  "fort": "heritage",
  "palace": "heritage",
  "temple": "spiritual",
  "shrine": "spiritual",
  "mosque": "spiritual",
  "church": "spiritual",
  "monastery": "spiritual",
  "wildlife": "wildlife",
  "national park": "wildlife",
  "sanctuary": "wildlife",
  "lake": "nature",
  "hill": "mountains",
  "mount": "mountains",
  "desert": "desert",
  "museum": "culture",
  "market": "shopping",
  "garden": "nature",
  "waterfall": "nature",
  "cave": "adventure",
  "river": "nature",
}

ATTRACTION_CATEGORY_KEYWORDS = {
  "fort": "fort",
  "palace": "palace",
  "temple": "temple",
  "church": "church",
  "mosque": "mosque",
  "lake": "lake",
  "park": "park",
  "sanctuary": "wildlife",
  "museum": "museum",
  "beach": "beach",
  "garden": "garden",
  "waterfall": "waterfall",
  "cave": "cave",
  "market": "market",
  "island": "island",
  "monastery": "monastery",
}


def log(message: str, **context: object) -> None:
  if context:
    print(f"[india-data] {message} {json.dumps(context, sort_keys=True)}", flush=True)
    return
  print(f"[india-data] {message}", flush=True)


def normalize_text(value: object, fallback: str = "") -> str:
  if value is None:
    return fallback
  normalized = re.sub(r"\s+", " ", str(value)).strip()
  return normalized or fallback


def normalize_lookup_key(value: object) -> str:
  ascii_text = unicodedata.normalize("NFKD", normalize_text(value))
  ascii_text = "".join(character for character in ascii_text if not unicodedata.combining(character))
  return re.sub(r"[^a-z0-9]+", " ", ascii_text.lower()).strip()


def slugify(value: object) -> str:
  ascii_text = unicodedata.normalize("NFKD", normalize_text(value))
  ascii_text = "".join(character for character in ascii_text if not unicodedata.combining(character))
  ascii_text = ascii_text.lower()
  ascii_text = re.sub(r"[^a-z0-9]+", "-", ascii_text)
  return ascii_text.strip("-")


def humanize_slug(slug: str) -> str:
  return " ".join(segment.capitalize() for segment in slug.split("-") if segment)


def truncate_text(value: str, length: int) -> str:
  normalized = normalize_text(value)
  if len(normalized) <= length:
    return normalized
  return normalized[: length - 1].rstrip() + "…"


def safe_float(value: object) -> float | None:
  try:
    if value in ("", None):
      return None
    return float(value)
  except (TypeError, ValueError):
    return None


def safe_int(value: object) -> int | None:
  parsed = safe_float(value)
  if parsed is None:
    return None
  return int(round(parsed))


def minutes_from_hours(value: object) -> int | None:
  hours = safe_float(value)
  if hours is None:
    return None
  return int(round(hours * 60))


def estimate_drive_duration_minutes(distance_km: float | None) -> int | None:
  if distance_km is None or distance_km <= 0:
    return None
  return int(round((distance_km / 32.0) * 60))


def estimate_minimum_flight_duration_minutes(distance_km: float | None) -> int | None:
  if distance_km is None or distance_km <= 0:
    return None

  # The source flight sheets skew toward airborne-time estimates. Apply a
  # conservative block-time floor so multimodal ranking does not overvalue
  # implausibly short flights.
  return max(30, int(round(25 + (distance_km / 780.0) * 60)))


def sanitize_flight_duration_minutes(
  distance_km: float | None,
  duration_minutes: int | None,
) -> tuple[int | None, bool]:
  if duration_minutes is None or duration_minutes <= 0:
    return duration_minutes, False

  minimum_duration = estimate_minimum_flight_duration_minutes(distance_km)
  if minimum_duration is None or duration_minutes >= minimum_duration:
    return duration_minutes, False

  return minimum_duration, True


def haversine_distance_km(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> float:
  earth_radius_km = 6371.0
  latitude_delta = math.radians(to_lat - from_lat)
  longitude_delta = math.radians(to_lon - from_lon)
  from_latitude = math.radians(from_lat)
  to_latitude = math.radians(to_lat)
  a = (
    math.sin(latitude_delta / 2) ** 2 +
    math.cos(from_latitude) * math.cos(to_latitude) * math.sin(longitude_delta / 2) ** 2
  )
  c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
  return earth_radius_km * c


def unique_preserving_order(values: Iterable[str]) -> list[str]:
  seen = set()
  result: list[str] = []
  for value in values:
    normalized = normalize_text(value)
    if not normalized or normalized in seen:
      continue
    seen.add(normalized)
    result.append(normalized)
  return result


@dataclass
class PageLink:
  href: str
  text: str


@dataclass
class ParsedPage:
  url: str
  title: str
  meta: dict[str, str]
  links: list[PageLink]


class SimplePageParser(HTMLParser):
  def __init__(self) -> None:
    super().__init__(convert_charrefs=True)
    self.in_title = False
    self.title_parts: list[str] = []
    self.meta: dict[str, str] = {}
    self.links: list[PageLink] = []
    self._active_href: str | None = None
    self._active_text_parts: list[str] = []

  def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
    attributes = {name.lower(): (value or "") for name, value in attrs}
    if tag.lower() == "title":
      self.in_title = True
      return
    if tag.lower() == "meta":
      key = normalize_text(attributes.get("property") or attributes.get("name")).lower()
      content = normalize_text(attributes.get("content"))
      if key and content:
        self.meta[key] = content
      return
    if tag.lower() == "a":
      href = normalize_text(attributes.get("href"))
      if href:
        self._active_href = href
        self._active_text_parts = []

  def handle_endtag(self, tag: str) -> None:
    if tag.lower() == "title":
      self.in_title = False
      return
    if tag.lower() == "a" and self._active_href:
      self.links.append(PageLink(href=self._active_href, text=normalize_text("".join(self._active_text_parts))))
      self._active_href = None
      self._active_text_parts = []

  def handle_data(self, data: str) -> None:
    if self.in_title:
      self.title_parts.append(data)
    if self._active_href:
      self._active_text_parts.append(data)

  def as_page(self, url: str) -> ParsedPage:
    return ParsedPage(
      url=url,
      title=normalize_text("".join(self.title_parts)),
      meta=self.meta,
      links=self.links,
    )


class HttpClient:
  def __init__(self) -> None:
    self.page_cache: dict[str, ParsedPage] = {}
    self.text_cache: dict[str, str] = {}
    self.json_cache: dict[str, object] = {}
    self._last_official_request_at = 0.0
    self._last_wikidata_request_at = 0.0
    self._last_nominatim_request_at = 0.0

  def _sleep_if_needed(self, bucket: str) -> None:
    now = time.monotonic()
    if bucket == "official":
      delay = OFFICIAL_SITE_REQUEST_DELAY_SECONDS
      last_time = self._last_official_request_at
    elif bucket == "wikidata":
      delay = WIKIDATA_REQUEST_DELAY_SECONDS
      last_time = self._last_wikidata_request_at
    else:
      delay = NOMINATIM_REQUEST_DELAY_SECONDS
      last_time = self._last_nominatim_request_at

    sleep_for = delay - (now - last_time)
    if sleep_for > 0:
      time.sleep(sleep_for)

    now = time.monotonic()
    if bucket == "official":
      self._last_official_request_at = now
    elif bucket == "wikidata":
      self._last_wikidata_request_at = now
    else:
      self._last_nominatim_request_at = now

  def fetch_text(self, url: str, user_agent: str = HTTP_USER_AGENT, bucket: str = "official") -> str:
    if url in self.text_cache:
      return self.text_cache[url]

    self._sleep_if_needed(bucket)
    request = urllib.request.Request(url, headers={"User-Agent": user_agent, "Accept-Language": "en"})
    try:
      with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        payload = response.read().decode("utf-8", "ignore")
    except urllib.error.URLError as error:
      if (
        bucket in {"official", "wikidata", "nominatim"} and
        isinstance(getattr(error, "reason", None), ssl.SSLCertVerificationError)
      ):
        log("Retrying source fetch with SSL verification fallback", url=url, bucket=bucket)
        insecure_context = ssl._create_unverified_context()
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS, context=insecure_context) as response:
          payload = response.read().decode("utf-8", "ignore")
      else:
        raise
    self.text_cache[url] = payload
    return payload

  def fetch_json(self, url: str, user_agent: str = HTTP_USER_AGENT, bucket: str = "official") -> object:
    if url in self.json_cache:
      return self.json_cache[url]
    payload = self.fetch_text(url, user_agent=user_agent, bucket=bucket)
    parsed = json.loads(payload)
    self.json_cache[url] = parsed
    return parsed

  def fetch_page(self, url: str) -> ParsedPage:
    if url in self.page_cache:
      return self.page_cache[url]
    html = self.fetch_text(url)
    parser = SimplePageParser()
    parser.feed(html)
    page = parser.as_page(url)
    self.page_cache[url] = page
    return page


def normalize_state_name(state_slug: str) -> str:
  return STATE_SLUG_NAME_MAP.get(state_slug, humanize_slug(state_slug))


def get_page_description(page: ParsedPage) -> str:
  return (
    normalize_text(page.meta.get("og:description")) or
    normalize_text(page.meta.get("description")) or
    ""
  )


def get_page_image(page: ParsedPage) -> str:
  return normalize_text(page.meta.get("og:image"))


def get_page_title(page: ParsedPage) -> str:
  return (
    normalize_text(page.meta.get("og:title")) or
    normalize_text(page.title)
  )


def parse_state_slug(url: str) -> str:
  path_segments = [segment for segment in urllib.parse.urlparse(url).path.split("/") if segment]
  return path_segments[1] if len(path_segments) >= 2 else ""


def parse_destination_slug(url: str) -> str:
  path_segments = [segment for segment in urllib.parse.urlparse(url).path.split("/") if segment]
  return path_segments[2] if len(path_segments) >= 3 else ""


def extract_state_links(page: ParsedPage) -> list[str]:
  candidates: list[str] = []
  for link in page.links:
    href = normalize_text(link.href)
    if not href.startswith(f"{INCREDIBLE_INDIA_BASE_URL}/en/"):
      continue
    path_segments = [segment for segment in urllib.parse.urlparse(href).path.split("/") if segment]
    if len(path_segments) != 2 or path_segments[0] != "en":
      continue
    state_slug = path_segments[1]
    if state_slug in EXCLUDED_LISTING_SLUGS:
      continue
    candidates.append(href)

  unique_links = unique_preserving_order(candidates)
  filtered_links = [link for link in unique_links if parse_state_slug(link) in STATE_SLUG_NAME_MAP]
  return filtered_links


def extract_destination_links(page: ParsedPage, state_slug: str) -> list[PageLink]:
  destination_links: list[PageLink] = []
  for link in page.links:
    href = normalize_text(link.href)
    if not href.startswith(f"{INCREDIBLE_INDIA_BASE_URL}/en/{state_slug}/"):
      continue
    path_segments = [segment for segment in urllib.parse.urlparse(href).path.split("/") if segment]
    if len(path_segments) != 3:
      continue
    destination_links.append(PageLink(href=href, text=link.text))

  deduped_by_href: dict[str, PageLink] = {}
  for link in destination_links:
    existing = deduped_by_href.get(link.href)
    if existing and existing.text:
      continue
    deduped_by_href[link.href] = link
  return list(deduped_by_href.values())


def extract_attraction_links(page: ParsedPage, state_slug: str, destination_slug: str) -> list[PageLink]:
  prefix = f"{INCREDIBLE_INDIA_BASE_URL}/en/{state_slug}/{destination_slug}/"
  attraction_links: list[PageLink] = []
  for link in page.links:
    href = normalize_text(link.href)
    if not href.startswith(prefix):
      continue
    path_segments = [segment for segment in urllib.parse.urlparse(href).path.split("/") if segment]
    if len(path_segments) < 4:
      continue
    attraction_links.append(PageLink(href=href, text=link.text))

  deduped_by_slug: dict[str, PageLink] = {}
  for link in attraction_links:
    attraction_slug = path_segments = [segment for segment in urllib.parse.urlparse(link.href).path.split("/") if segment][-1]
    existing = deduped_by_slug.get(attraction_slug)
    if existing and existing.text:
      continue
    deduped_by_slug[attraction_slug] = link

  return list(deduped_by_slug.values())[:TOP_ATTRACTIONS_PER_DESTINATION]


def derive_attraction_category(name: str) -> str:
  normalized_name = normalize_lookup_key(name)
  for keyword, category in ATTRACTION_CATEGORY_KEYWORDS.items():
    if keyword in normalized_name:
      return category
  return "attraction"


def derive_destination_tags(description: str, attraction_names: Iterable[str]) -> list[str]:
  bag = " ".join([normalize_text(description), *[normalize_text(name) for name in attraction_names]]).lower()
  tags = {tag for keyword, tag in TOURISM_TAG_KEYWORDS.items() if keyword in bag}
  return sorted(tags)


def resolve_display_name(link_text: str, slug: str, title: str = "") -> str:
  if normalize_text(link_text):
    return normalize_text(link_text)

  normalized_title = normalize_text(title)
  if normalized_title:
    normalized_title = re.sub(r"\s*\|\s*Incredible India\s*$", "", normalized_title, flags=re.I)
    normalized_title = re.sub(r"^(Places to Visit in|Explore|Travel to|Visit)\s+", "", normalized_title, flags=re.I)
    if normalized_title:
      return normalized_title

  return humanize_slug(slug)


def build_label(name: str, state_name: str) -> str:
  return f"{name}, {state_name}, India"


def parse_xlsx_rows(path: Path) -> list[list[str]]:
  namespace = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
  }

  def clean_target(target: str) -> str:
    target = target.lstrip("/")
    if target.startswith("xl/"):
      return target
    return f"xl/{target}"

  def column_to_index(column_name: str) -> int:
    total = 0
    for character in column_name:
      if character.isalpha():
        total = total * 26 + (ord(character.upper()) - 64)
    return total - 1

  with ZipFile(path) as workbook_archive:
    shared_strings: list[str] = []
    if "xl/sharedStrings.xml" in workbook_archive.namelist():
      shared_root = ET.fromstring(workbook_archive.read("xl/sharedStrings.xml"))
      for string_item in shared_root.findall("main:si", namespace):
        shared_strings.append(
          "".join(text_node.text or "" for text_node in string_item.iterfind(".//main:t", namespace))
        )

    workbook_root = ET.fromstring(workbook_archive.read("xl/workbook.xml"))
    relationships_root = ET.fromstring(workbook_archive.read("xl/_rels/workbook.xml.rels"))
    relationship_map = {
      relationship.attrib["Id"]: clean_target(relationship.attrib["Target"])
      for relationship in relationships_root.findall("pkgrel:Relationship", namespace)
    }
    first_sheet = workbook_root.find("main:sheets/main:sheet", namespace)
    if first_sheet is None:
      return []
    relationship_id = first_sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
    sheet_root = ET.fromstring(workbook_archive.read(relationship_map[relationship_id]))

    rows: list[list[str]] = []
    for row in sheet_root.findall(".//main:sheetData/main:row", namespace):
      values: dict[int, str] = {}
      max_index = -1
      for cell in row.findall("main:c", namespace):
        cell_reference = cell.attrib.get("r", "")
        column_name = "".join(character for character in cell_reference if character.isalpha())
        column_index = column_to_index(column_name)
        max_index = max(max_index, column_index)
        cell_type = cell.attrib.get("t")
        value = ""
        if cell_type == "inlineStr":
          value = "".join(text_node.text or "" for text_node in cell.iterfind(".//main:t", namespace))
        else:
          raw_value_node = cell.find("main:v", namespace)
          if raw_value_node is not None and raw_value_node.text is not None:
            raw_value = raw_value_node.text
            if cell_type == "s" and raw_value.isdigit():
              shared_index = int(raw_value)
              if 0 <= shared_index < len(shared_strings):
                value = shared_strings[shared_index]
              else:
                value = raw_value
            else:
              value = raw_value
        values[column_index] = value

      if max_index >= 0:
        rows.append([values.get(index, "") for index in range(max_index + 1)])

    return rows


def read_csv_dict_rows(path: Path) -> list[dict[str, str]]:
  with path.open("r", encoding="utf-8-sig", newline="") as file_handle:
    return list(csv.DictReader(file_handle))


def normalize_transport_city_name(value: object) -> str:
  raw_name = normalize_text(value)
  if not raw_name or raw_name == INVALID_TRANSPORT_CITY_LABEL:
    return ""
  alias = CITY_ALIAS_SEEDS.get(normalize_lookup_key(raw_name))
  if alias:
    return alias
  return humanize_slug(slugify(raw_name))


def normalize_destination_name(value: object) -> str:
  raw_name = normalize_text(value)
  if not raw_name:
    return ""
  alias = DESTINATION_ALIAS_SEEDS.get(normalize_lookup_key(raw_name))
  if alias:
    return alias
  return raw_name


def load_transport_rows(args: argparse.Namespace) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
  flight_rows: list[dict[str, object]] = []
  for row in read_csv_dict_rows(args.flight_csv):
    flight_rows.append({
      "source_raw": normalize_text(row.get("Source")),
      "destination_raw": normalize_text(row.get("Destination")),
      "mode_raw": normalize_text(row.get("Mode")),
      "distance_km": safe_float(row.get("Distance_km")),
      "time_hours": safe_float(row.get("Travel_Time_hr")),
      "availability_raw": normalize_text(row.get("Availability")),
    })

  flight_overlay_rows: list[dict[str, object]] = []
  if args.flight_overlay_csv and args.flight_overlay_csv.exists():
    for row in read_csv_dict_rows(args.flight_overlay_csv):
      flight_overlay_rows.append({
        "source_raw": normalize_text(row.get("source_city")),
        "destination_raw": normalize_text(row.get("destination_city")),
        "distance_km": safe_float(row.get("distance_km")),
        "time_hours": safe_float(row.get("time_hours")),
      })
  else:
    flight_xlsx_rows = parse_xlsx_rows(args.flight_xlsx)
    for row in flight_xlsx_rows[1:]:
      padded = list(row) + [""] * max(0, 4 - len(row))
      flight_overlay_rows.append({
        "source_raw": normalize_text(padded[0]),
        "destination_raw": normalize_text(padded[1]),
        "distance_km": safe_float(padded[2]),
        "time_hours": safe_float(padded[3]),
      })

  road_rows: list[dict[str, object]] = []
  if args.road_csv and args.road_csv.exists():
    for row in read_csv_dict_rows(args.road_csv):
      road_rows.append({
        "source_raw": normalize_text(row.get("source_city")),
        "destination_raw": normalize_text(row.get("destination_city")),
        "distance_km": safe_float(row.get("distance_km")),
        "time_hours": safe_float(row.get("time_hours")),
      })
  else:
    road_xlsx_rows = parse_xlsx_rows(args.road_xlsx)
    for row in road_xlsx_rows[1:]:
      padded = list(row) + [""] * max(0, 4 - len(row))
      road_rows.append({
        "source_raw": normalize_text(padded[0]),
        "destination_raw": normalize_text(padded[1]),
        "distance_km": safe_float(padded[2]),
        "time_hours": safe_float(padded[3]),
      })

  train_rows: list[dict[str, object]] = []
  if args.train_csv and args.train_csv.exists():
    for row in read_csv_dict_rows(args.train_csv):
      train_rows.append({
        "source_raw": normalize_text(row.get("source_city")),
        "destination_raw": normalize_text(row.get("destination_city")),
        "distance_km": safe_float(row.get("distance_km")),
        "time_hours": safe_float(row.get("time_hours")),
        "train_type": normalize_text(row.get("train_type")),
        "cost_general": safe_int(row.get("cost_general")),
        "cost_sleeper": safe_int(row.get("cost_sleeper")),
        "cost_ac3": safe_int(row.get("cost_ac3")),
        "cost_ac2": safe_int(row.get("cost_ac2")),
        "cost_ac1": safe_int(row.get("cost_ac1")),
      })
  else:
    train_xlsx_rows = parse_xlsx_rows(args.train_xlsx)
    for row in train_xlsx_rows[1:]:
      padded = list(row) + [""] * max(0, 10 - len(row))
      train_rows.append({
        "source_raw": normalize_text(padded[0]),
        "destination_raw": normalize_text(padded[1]),
        "distance_km": safe_float(padded[2]),
        "time_hours": safe_float(padded[3]),
        "train_type": normalize_text(padded[4]),
        "cost_general": safe_int(padded[5]),
        "cost_sleeper": safe_int(padded[6]),
        "cost_ac3": safe_int(padded[7]),
        "cost_ac2": safe_int(padded[8]),
        "cost_ac1": safe_int(padded[9]),
      })

  return flight_rows, flight_overlay_rows, road_rows, train_rows


def build_transport_city_catalog(
  client: HttpClient,
  flight_rows: list[dict[str, object]],
  flight_overlay_rows: list[dict[str, object]],
  road_rows: list[dict[str, object]],
  train_rows: list[dict[str, object]],
) -> tuple[dict[str, dict[str, object]], dict[str, str], list[dict[str, object]]]:
  aliases_by_canonical: dict[str, set[str]] = defaultdict(set)
  mode_support: dict[str, dict[str, bool]] = defaultdict(lambda: {"has_flight": False, "has_train": False, "has_road": False})

  def register_city(raw_name: str, mode_flag: str) -> None:
    canonical_name = normalize_transport_city_name(raw_name)
    if not canonical_name:
      return
    aliases_by_canonical[canonical_name].add(raw_name)
    aliases_by_canonical[canonical_name].add(canonical_name)
    mode_support[canonical_name][mode_flag] = True

  for row in flight_rows:
    register_city(str(row["source_raw"]), "has_flight")
    register_city(str(row["destination_raw"]), "has_flight")
  for row in flight_overlay_rows:
    register_city(str(row["source_raw"]), "has_flight")
    register_city(str(row["destination_raw"]), "has_flight")
  for row in road_rows:
    register_city(str(row["source_raw"]), "has_road")
    register_city(str(row["destination_raw"]), "has_road")
  for row in train_rows:
    register_city(str(row["source_raw"]), "has_train")
    register_city(str(row["destination_raw"]), "has_train")

  city_catalog: dict[str, dict[str, object]] = {}
  alias_lookup: dict[str, str] = {}
  city_alias_records: list[dict[str, object]] = []

  for canonical_name in sorted(aliases_by_canonical.keys()):
    location = resolve_location(client, canonical_name, "", "transport_city")
    city_id = f"city-{slugify(canonical_name)}"
    state_name = normalize_text(location.get("state_ut_name"))
    aliases = sorted(unique_preserving_order(aliases_by_canonical[canonical_name]))
    city_record = {
      "city_id": city_id,
      "canonical_name": canonical_name,
      "state_ut_name": state_name,
      "latitude": location.get("latitude"),
      "longitude": location.get("longitude"),
      "aliases": aliases,
      "has_flight": mode_support[canonical_name]["has_flight"],
      "has_train": mode_support[canonical_name]["has_train"],
      "has_road": mode_support[canonical_name]["has_road"],
    }
    city_catalog[canonical_name] = city_record
    for alias in aliases:
      alias_lookup[normalize_lookup_key(alias)] = canonical_name
    city_alias_records.append({
      "canonical_name": canonical_name,
      "aliases": aliases,
      "state_ut_name": state_name,
    })

  return city_catalog, alias_lookup, city_alias_records


def availability_status(raw_value: str) -> str:
  normalized = normalize_lookup_key(raw_value)
  if normalized == "yes":
    return "available"
  if normalized == "no":
    return "unavailable"
  return "unknown"


def choose_better_route(candidate: dict[str, object], existing: dict[str, object] | None) -> dict[str, object]:
  if existing is None:
    return candidate

  def score(route: dict[str, object]) -> tuple[int, int, int]:
    source_quality = normalize_text(route.get("source_quality"))
    availability = normalize_text(route.get("availability_status"))
    return (
      2 if source_quality == "high" else 1 if source_quality == "medium" else 0,
      1 if availability == "available" else 0,
      1 if safe_int(route.get("duration_minutes")) not in (None, 0) else 0,
    )

  return candidate if score(candidate) > score(existing) else existing


def build_transport_routes(
  flight_rows: list[dict[str, object]],
  flight_overlay_rows: list[dict[str, object]],
  road_rows: list[dict[str, object]],
  train_rows: list[dict[str, object]],
  city_catalog: dict[str, dict[str, object]],
  alias_lookup: dict[str, str],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
  route_records: dict[str, dict[str, object]] = {}
  quarantined_records: list[dict[str, object]] = []
  flight_duration_repair_count = 0

  overlay_by_key: dict[tuple[str, str], dict[str, object]] = {}
  for overlay_row in flight_overlay_rows:
    source_name = alias_lookup.get(normalize_lookup_key(overlay_row["source_raw"]), normalize_transport_city_name(overlay_row["source_raw"]))
    destination_name = alias_lookup.get(normalize_lookup_key(overlay_row["destination_raw"]), normalize_transport_city_name(overlay_row["destination_raw"]))
    if not source_name or not destination_name:
      continue
    overlay_by_key[(source_name, destination_name)] = overlay_row

  def source_city_id(city_name: str) -> str:
    return str(city_catalog[city_name]["city_id"])

  def emit_route(route: dict[str, object]) -> None:
    route_key = str(route["route_id"])
    route_records[route_key] = choose_better_route(route, route_records.get(route_key))

  def quarantine(mode: str, source_raw: str, destination_raw: str, reason: str, raw_record: dict[str, object]) -> None:
    quarantined_records.append({
      "mode": mode,
      "source_raw": source_raw,
      "destination_raw": destination_raw,
      "reason": reason,
      "raw_record": raw_record,
    })

  for row in flight_rows:
    source_name = alias_lookup.get(normalize_lookup_key(row["source_raw"]), normalize_transport_city_name(row["source_raw"]))
    destination_name = alias_lookup.get(normalize_lookup_key(row["destination_raw"]), normalize_transport_city_name(row["destination_raw"]))
    if not source_name or not destination_name:
      quarantine("flight", str(row["source_raw"]), str(row["destination_raw"]), "unresolved_city_name", row)
      continue
    if source_name == destination_name:
      quarantine("flight", str(row["source_raw"]), str(row["destination_raw"]), "self_loop", row)
      continue

    overlay = overlay_by_key.get((source_name, destination_name))
    distance_km = overlay.get("distance_km") if overlay else row.get("distance_km")
    time_hours = overlay.get("time_hours") if overlay else row.get("time_hours")
    distance_km = safe_float(distance_km)
    duration_minutes = minutes_from_hours(time_hours)
    if duration_minutes is None or duration_minutes <= 0:
      quarantine("flight", str(row["source_raw"]), str(row["destination_raw"]), "non_positive_duration", row)
      continue
    duration_minutes, was_duration_repaired = sanitize_flight_duration_minutes(distance_km, duration_minutes)
    if was_duration_repaired:
      flight_duration_repair_count += 1

    route_id = f"flight:{slugify(source_name)}:{slugify(destination_name)}"
    emit_route({
      "route_id": route_id,
      "source_city_id": source_city_id(source_name),
      "destination_city_id": source_city_id(destination_name),
      "mode": "flight",
      "submode": "flight_standard",
      "distance_km": distance_km,
      "duration_minutes": duration_minutes,
      "availability_status": availability_status(str(row["availability_raw"])),
      "cost_general": None,
      "cost_sleeper": None,
      "cost_ac3": None,
      "cost_ac2": None,
      "cost_ac1": None,
      "cost_is_estimated": False,
      "source_dataset": (
        "flight_csv_with_xlsx_overlay_sanitized"
        if overlay and was_duration_repaired
        else "flight_csv_with_xlsx_overlay"
        if overlay
        else "flight_csv_sanitized"
        if was_duration_repaired
        else "flight_csv"
      ),
      "source_quality": "high" if overlay else "medium",
      "raw_route_key": f"{row['source_raw']}::{row['destination_raw']}",
    })

  for overlay_key, overlay_row in overlay_by_key.items():
    route_id = f"flight:{slugify(overlay_key[0])}:{slugify(overlay_key[1])}"
    if route_id in route_records:
      continue
    distance_km = safe_float(overlay_row.get("distance_km"))
    duration_minutes = minutes_from_hours(overlay_row.get("time_hours"))
    if duration_minutes is None or duration_minutes <= 0:
      quarantine("flight", str(overlay_row["source_raw"]), str(overlay_row["destination_raw"]), "overlay_non_positive_duration", overlay_row)
      continue
    duration_minutes, was_duration_repaired = sanitize_flight_duration_minutes(distance_km, duration_minutes)
    if was_duration_repaired:
      flight_duration_repair_count += 1
    emit_route({
      "route_id": route_id,
      "source_city_id": source_city_id(overlay_key[0]),
      "destination_city_id": source_city_id(overlay_key[1]),
      "mode": "flight",
      "submode": "flight_standard",
      "distance_km": distance_km,
      "duration_minutes": duration_minutes,
      "availability_status": "unknown",
      "cost_general": None,
      "cost_sleeper": None,
      "cost_ac3": None,
      "cost_ac2": None,
      "cost_ac1": None,
      "cost_is_estimated": False,
      "source_dataset": "flight_xlsx_sanitized" if was_duration_repaired else "flight_xlsx",
      "source_quality": "medium",
      "raw_route_key": f"{overlay_row['source_raw']}::{overlay_row['destination_raw']}",
    })

  for row in road_rows:
    source_name = alias_lookup.get(normalize_lookup_key(row["source_raw"]), normalize_transport_city_name(row["source_raw"]))
    destination_name = alias_lookup.get(normalize_lookup_key(row["destination_raw"]), normalize_transport_city_name(row["destination_raw"]))
    if not source_name or not destination_name:
      quarantine("road", str(row["source_raw"]), str(row["destination_raw"]), "unresolved_city_name", row)
      continue
    if source_name == destination_name:
      quarantine("road", str(row["source_raw"]), str(row["destination_raw"]), "self_loop", row)
      continue
    duration_minutes = minutes_from_hours(row.get("time_hours"))
    if duration_minutes is None or duration_minutes <= 0:
      quarantine("road", str(row["source_raw"]), str(row["destination_raw"]), "non_positive_duration", row)
      continue
    route_id = f"road:{slugify(source_name)}:{slugify(destination_name)}"
    emit_route({
      "route_id": route_id,
      "source_city_id": source_city_id(source_name),
      "destination_city_id": source_city_id(destination_name),
      "mode": "road",
      "submode": "road_intercity",
      "distance_km": row.get("distance_km"),
      "duration_minutes": duration_minutes,
      "availability_status": "unknown",
      "cost_general": None,
      "cost_sleeper": None,
      "cost_ac3": None,
      "cost_ac2": None,
      "cost_ac1": None,
      "cost_is_estimated": False,
      "source_dataset": "roadways_xlsx",
      "source_quality": "medium",
      "raw_route_key": f"{row['source_raw']}::{row['destination_raw']}",
    })

  for row in train_rows:
    source_name = alias_lookup.get(normalize_lookup_key(row["source_raw"]), normalize_transport_city_name(row["source_raw"]))
    destination_name = alias_lookup.get(normalize_lookup_key(row["destination_raw"]), normalize_transport_city_name(row["destination_raw"]))
    if not source_name or not destination_name:
      quarantine("train", str(row["source_raw"]), str(row["destination_raw"]), "unresolved_city_name", row)
      continue
    if source_name == destination_name:
      quarantine("train", str(row["source_raw"]), str(row["destination_raw"]), "self_loop", row)
      continue
    duration_minutes = minutes_from_hours(row.get("time_hours"))
    if duration_minutes is None or duration_minutes <= 0:
      quarantine("train", str(row["source_raw"]), str(row["destination_raw"]), "non_positive_duration", row)
      continue
    route_id = f"train:{slugify(source_name)}:{slugify(destination_name)}:{slugify(row.get('train_type')) or 'standard'}"
    emit_route({
      "route_id": route_id,
      "source_city_id": source_city_id(source_name),
      "destination_city_id": source_city_id(destination_name),
      "mode": "train",
      "submode": normalize_text(row.get("train_type"), "train_standard"),
      "distance_km": row.get("distance_km"),
      "duration_minutes": duration_minutes,
      "availability_status": "unknown",
      "cost_general": row.get("cost_general"),
      "cost_sleeper": row.get("cost_sleeper"),
      "cost_ac3": row.get("cost_ac3"),
      "cost_ac2": row.get("cost_ac2"),
      "cost_ac1": row.get("cost_ac1"),
      "cost_is_estimated": False,
      "source_dataset": "train_xlsx",
      "source_quality": "high",
      "raw_route_key": f"{row['source_raw']}::{row['destination_raw']}::{row['train_type']}",
    })

  if flight_duration_repair_count > 0:
    log("Applied flight duration sanity repairs", repair_count=flight_duration_repair_count)

  return sorted(route_records.values(), key=lambda route: route["route_id"]), quarantined_records


def try_wikidata_location(client: HttpClient, query: str, state_name: str) -> dict[str, object] | None:
  search_query = urllib.parse.urlencode({
    "action": "wbsearchentities",
    "search": query,
    "language": "en",
    "format": "json",
    "type": "item",
    "limit": "5",
  })
  search_url = f"{WIKIDATA_SEARCH_URL}?{search_query}"
  try:
    payload = client.fetch_json(search_url, user_agent=HTTP_USER_AGENT, bucket="wikidata")
  except Exception:
    return None

  search_results = payload.get("search", []) if isinstance(payload, dict) else []
  state_key = normalize_lookup_key(state_name)
  query_key = normalize_lookup_key(query)

  for result in search_results:
    entity_id = normalize_text(result.get("id"))
    description = normalize_lookup_key(result.get("description"))
    label = normalize_lookup_key(result.get("label"))
    if "india" not in description and state_key and state_key not in description:
      continue
    if query_key and query_key not in label and query_key not in normalize_lookup_key(result.get("match", {}).get("text")):
      continue
    if not entity_id:
      continue
    try:
      entity_payload = client.fetch_json(
        WIKIDATA_ENTITY_URL.format(entity_id=entity_id),
        user_agent=HTTP_USER_AGENT,
        bucket="wikidata",
      )
    except Exception:
      continue
    entity = entity_payload.get("entities", {}).get(entity_id, {}) if isinstance(entity_payload, dict) else {}
    claims = entity.get("claims", {})
    coordinate_claims = claims.get("P625", [])
    if not coordinate_claims:
      continue
    data_value = coordinate_claims[0].get("mainsnak", {}).get("datavalue", {}).get("value", {})
    latitude = safe_float(data_value.get("latitude"))
    longitude = safe_float(data_value.get("longitude"))
    if latitude is None or longitude is None:
      continue
    aliases = [
      normalize_text(alias.get("value"))
      for alias in entity.get("aliases", {}).get("en", [])
      if normalize_text(alias.get("value"))
    ]
    return {
      "latitude": latitude,
      "longitude": longitude,
      "geo_source": "wikidata",
      "source_confidence": 0.9,
      "aliases": aliases,
      "wikidata_id": entity_id,
    }

  return None


def try_nominatim_location(client: HttpClient, query: str, state_name: str) -> dict[str, object] | None:
  params = urllib.parse.urlencode({
    "q": f"{query}, {state_name}, India" if state_name else f"{query}, India",
    "format": "jsonv2",
    "limit": "1",
  })
  url = f"{NOMINATIM_SEARCH_URL}?{params}"
  try:
    payload = client.fetch_json(url, user_agent=NOMINATIM_USER_AGENT, bucket="nominatim")
  except Exception:
    return None

  if not isinstance(payload, list) or not payload:
    return None

  result = payload[0]
  latitude = safe_float(result.get("lat"))
  longitude = safe_float(result.get("lon"))
  if latitude is None or longitude is None:
    return None

  address = result.get("address", {}) if isinstance(result, dict) else {}
  resolved_state_name = (
    normalize_text(address.get("state")) or
    normalize_text(address.get("union_territory")) or
    normalize_text(address.get("state_district")) or
    state_name
  )
  return {
    "latitude": latitude,
    "longitude": longitude,
    "state_ut_name": resolved_state_name,
    "geo_source": "nominatim",
    "source_confidence": 0.75,
    "aliases": [],
    "wikidata_id": "",
  }


def resolve_location(client: HttpClient, name: str, state_name: str, scope: str) -> dict[str, object]:
  normalized_name = normalize_text(name)
  if not normalized_name:
    return {
      "latitude": None,
      "longitude": None,
      "state_ut_name": normalize_text(state_name),
      "geo_source": "",
      "source_confidence": 0.0,
      "aliases": [],
      "wikidata_id": "",
    }

  if scope == "transport_city":
    lookup_queries = [normalized_name]
  else:
    lookup_queries = [normalized_name, normalize_destination_name(normalized_name)]

  for lookup_query in unique_preserving_order(lookup_queries):
    wikidata_result = try_wikidata_location(client, lookup_query, state_name)
    if wikidata_result:
      wikidata_result.setdefault("state_ut_name", normalize_text(state_name))
      return wikidata_result

  nominatim_result = try_nominatim_location(client, normalized_name, state_name)
  if nominatim_result:
    return nominatim_result

  return {
    "latitude": None,
    "longitude": None,
    "state_ut_name": normalize_text(state_name),
    "geo_source": "",
    "source_confidence": 0.0,
    "aliases": [],
    "wikidata_id": "",
  }


def build_destination_hubs(
  destinations: list[dict[str, object]],
  city_catalog: dict[str, dict[str, object]],
  alias_lookup: dict[str, str],
) -> list[dict[str, object]]:
  destination_hubs: list[dict[str, object]] = []

  for destination in destinations:
    destination_name = normalize_text(destination["destination_name"])
    state_name = normalize_text(destination["state_ut_name"])
    destination_latitude = safe_float(destination.get("latitude"))
    destination_longitude = safe_float(destination.get("longitude"))

    exact_city_name = alias_lookup.get(normalize_lookup_key(destination_name))
    if exact_city_name:
      exact_city = city_catalog.get(exact_city_name)
      if exact_city:
        destination_hubs.append({
          "destination_id": destination["destination_id"],
          "city_id": exact_city["city_id"],
          "hub_rank": 1,
          "access_distance_km": 0.0,
          "access_duration_minutes": 0,
          "matching_method": "exact_or_alias",
        })
        continue

    candidate_cities = list(city_catalog.values())
    same_state_candidates = [
      city for city in candidate_cities
      if normalize_lookup_key(city.get("state_ut_name")) == normalize_lookup_key(state_name)
    ]
    if destination_latitude is None or destination_longitude is None:
      continue

    preferred_pool = same_state_candidates if same_state_candidates else candidate_cities
    ranked_cities = []
    for city in preferred_pool:
      city_latitude = safe_float(city.get("latitude"))
      city_longitude = safe_float(city.get("longitude"))
      if city_latitude is None or city_longitude is None:
        continue
      distance_km = haversine_distance_km(destination_latitude, destination_longitude, city_latitude, city_longitude)
      ranked_cities.append((distance_km, city))

    for rank, (distance_km, city) in enumerate(sorted(ranked_cities, key=lambda item: item[0])[:3], start=1):
      destination_hubs.append({
        "destination_id": destination["destination_id"],
        "city_id": city["city_id"],
        "hub_rank": rank,
        "access_distance_km": round(distance_km, 2),
        "access_duration_minutes": estimate_drive_duration_minutes(distance_km),
        "matching_method": "same_state_geospatial" if same_state_candidates else "cross_state_geospatial",
      })

  return sorted(destination_hubs, key=lambda hub: (hub["destination_id"], hub["hub_rank"]))


def build_tourism_datasets(
  client: HttpClient,
  city_catalog: dict[str, dict[str, object]],
  alias_lookup: dict[str, str],
) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
  listing_page = client.fetch_page(INCREDIBLE_INDIA_LISTING_URL)
  state_links = extract_state_links(listing_page)
  log("Resolved state links", state_count=len(state_links))

  destinations: list[dict[str, object]] = []
  attractions: list[dict[str, object]] = []
  destinations_by_key: dict[str, dict[str, object]] = {}

  for state_link in state_links:
    state_slug = parse_state_slug(state_link)
    state_name = normalize_state_name(state_slug)
    state_page = client.fetch_page(state_link)
    destination_links = extract_destination_links(state_page, state_slug)
    log("Resolved destination links", state=state_name, destination_count=len(destination_links))

    for destination_link in destination_links:
      destination_url = destination_link.href
      destination_slug = parse_destination_slug(destination_url)
      destination_page = client.fetch_page(destination_url)
      destination_title = get_page_title(destination_page)
      destination_name = resolve_display_name(destination_link.text, destination_slug, destination_title)
      destination_name = normalize_destination_name(destination_name)
      destination_id = f"{state_slug}--{slugify(destination_name)}"
      if destination_id in destinations_by_key:
        continue

      matched_transport_city = alias_lookup.get(normalize_lookup_key(destination_name))
      if not matched_transport_city:
        matched_transport_city = alias_lookup.get(normalize_lookup_key(destination_link.text))

      if matched_transport_city:
        transport_city = city_catalog.get(matched_transport_city, {})
        location = {
          "latitude": transport_city.get("latitude"),
          "longitude": transport_city.get("longitude"),
          "state_ut_name": normalize_text(transport_city.get("state_ut_name"), state_name),
          "geo_source": "transport_city_match",
          "source_confidence": 0.95,
          "aliases": transport_city.get("aliases", []),
          "wikidata_id": "",
        }
      else:
        location = resolve_location(client, destination_name, state_name, "destination")

      attraction_links = extract_attraction_links(destination_page, state_slug, destination_slug)
      attraction_names = [
        resolve_display_name(attraction_link.text, urllib.parse.urlparse(attraction_link.href).path.split("/")[-1])
        for attraction_link in attraction_links
      ]
      destination_tags = derive_destination_tags(get_page_description(destination_page), attraction_names)
      destination_record = {
        "destination_id": destination_id,
        "state_ut_name": normalize_text(location.get("state_ut_name"), state_name),
        "state_ut_slug": state_slug,
        "destination_name": destination_name,
        "destination_slug": slugify(destination_name),
        "destination_type": "city_or_area",
        "country_code": DEFAULT_COUNTRY_CODE,
        "latitude": location.get("latitude"),
        "longitude": location.get("longitude"),
        "description": get_page_description(destination_page),
        "tags": destination_tags,
        "image_url": get_page_image(destination_page),
        "official_url": destination_url,
        "content_source": "incredible_india",
        "geo_source": normalize_text(location.get("geo_source")),
        "source_confidence": location.get("source_confidence"),
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
      }
      destinations.append(destination_record)
      destinations_by_key[destination_id] = destination_record

      for index, attraction_link in enumerate(attraction_links, start=1):
        attraction_slug = urllib.parse.urlparse(attraction_link.href).path.split("/")[-1]
        attraction_name = resolve_display_name(attraction_link.text, attraction_slug)
        attractions.append({
          "attraction_id": f"{destination_id}--{slugify(attraction_name)}",
          "destination_id": destination_id,
          "attraction_name": attraction_name,
          "category": derive_attraction_category(attraction_name),
          "latitude": None,
          "longitude": None,
          "summary": "",
          "source_url": attraction_link.href,
          "source_type": "official_link",
          "rank_within_destination": index,
          "source_confidence": 0.7 if attraction_link.text else 0.55,
        })

  destination_hubs = build_destination_hubs(destinations, city_catalog, alias_lookup)

  return (
    sorted(destinations, key=lambda destination: (destination["state_ut_name"], destination["destination_name"])),
    sorted(attractions, key=lambda attraction: (attraction["destination_id"], attraction["rank_within_destination"])),
    destination_hubs,
  )


def load_existing_tourism_seed(output_root: Path) -> tuple[list[dict[str, object]], list[dict[str, object]]] | None:
  destinations_path = output_root / "server" / "data" / "india" / "india_destinations.json"
  attractions_path = output_root / "server" / "data" / "india" / "india_attractions.json"

  if not destinations_path.exists() or not attractions_path.exists():
    return None

  return (
    json.loads(destinations_path.read_text(encoding="utf-8")),
    json.loads(attractions_path.read_text(encoding="utf-8")),
  )


def build_tourism_datasets_from_seed(
  client: HttpClient,
  city_catalog: dict[str, dict[str, object]],
  alias_lookup: dict[str, str],
  seeded_destinations: list[dict[str, object]],
  seeded_attractions: list[dict[str, object]],
) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
  last_synced_at = datetime.now(timezone.utc).isoformat()
  hydrated_destinations: list[dict[str, object]] = []
  valid_destination_ids: set[str] = set()

  for seeded_destination in seeded_destinations:
    destination_id = normalize_text(seeded_destination.get("destination_id"))
    destination_name = normalize_destination_name(seeded_destination.get("destination_name"))
    state_name = normalize_text(seeded_destination.get("state_ut_name"))

    if not destination_id or not destination_name or not state_name:
      continue

    matched_transport_city = alias_lookup.get(normalize_lookup_key(destination_name))
    if not matched_transport_city:
      matched_transport_city = alias_lookup.get(
        normalize_lookup_key(seeded_destination.get("destination_name"))
      )

    if matched_transport_city:
      transport_city = city_catalog.get(matched_transport_city, {})
      location = {
        "latitude": transport_city.get("latitude"),
        "longitude": transport_city.get("longitude"),
        "state_ut_name": normalize_text(transport_city.get("state_ut_name"), state_name),
        "geo_source": "transport_city_match",
        "source_confidence": 0.95,
      }
    elif (
      safe_float(seeded_destination.get("latitude")) is not None and
      safe_float(seeded_destination.get("longitude")) is not None
    ):
      location = {
        "latitude": safe_float(seeded_destination.get("latitude")),
        "longitude": safe_float(seeded_destination.get("longitude")),
        "state_ut_name": state_name,
        "geo_source": normalize_text(seeded_destination.get("geo_source")),
        "source_confidence": seeded_destination.get("source_confidence"),
      }
    else:
      location = resolve_location(client, destination_name, state_name, "destination")

    hydrated_destinations.append({
      "destination_id": destination_id,
      "state_ut_name": normalize_text(location.get("state_ut_name"), state_name),
      "state_ut_slug": normalize_text(seeded_destination.get("state_ut_slug"), slugify(state_name)),
      "destination_name": destination_name,
      "destination_slug": normalize_text(seeded_destination.get("destination_slug"), slugify(destination_name)),
      "destination_type": normalize_text(seeded_destination.get("destination_type"), "city_or_area"),
      "country_code": normalize_text(seeded_destination.get("country_code"), DEFAULT_COUNTRY_CODE),
      "latitude": location.get("latitude"),
      "longitude": location.get("longitude"),
      "description": normalize_text(seeded_destination.get("description")),
      "tags": list(seeded_destination.get("tags", [])) if isinstance(seeded_destination.get("tags"), list) else [],
      "image_url": normalize_text(seeded_destination.get("image_url")),
      "official_url": normalize_text(seeded_destination.get("official_url")),
      "content_source": normalize_text(seeded_destination.get("content_source"), "incredible_india"),
      "geo_source": normalize_text(location.get("geo_source")),
      "source_confidence": location.get("source_confidence"),
      "last_synced_at": last_synced_at,
    })
    valid_destination_ids.add(destination_id)

  hydrated_attractions = [
    {
      "attraction_id": normalize_text(attraction.get("attraction_id")),
      "destination_id": normalize_text(attraction.get("destination_id")),
      "attraction_name": normalize_text(attraction.get("attraction_name")),
      "category": normalize_text(attraction.get("category"), "attraction"),
      "latitude": safe_float(attraction.get("latitude")),
      "longitude": safe_float(attraction.get("longitude")),
      "summary": normalize_text(attraction.get("summary")),
      "source_url": normalize_text(attraction.get("source_url")),
      "source_type": normalize_text(attraction.get("source_type"), "official_link"),
      "rank_within_destination": safe_int(attraction.get("rank_within_destination")) or 1,
      "source_confidence": safe_float(attraction.get("source_confidence")) or 0.5,
    }
    for attraction in seeded_attractions
    if normalize_text(attraction.get("destination_id")) in valid_destination_ids
  ]

  destination_hubs = build_destination_hubs(hydrated_destinations, city_catalog, alias_lookup)

  return (
    sorted(hydrated_destinations, key=lambda destination: (destination["state_ut_name"], destination["destination_name"])),
    sorted(hydrated_attractions, key=lambda attraction: (attraction["destination_id"], attraction["rank_within_destination"])),
    destination_hubs,
  )


def build_generated_client_exports(
  destinations: list[dict[str, object]],
  attractions: list[dict[str, object]],
  destination_hubs: list[dict[str, object]],
  output_root: Path,
) -> None:
  attraction_count_by_destination: dict[str, int] = defaultdict(int)
  for attraction in attractions:
    attraction_count_by_destination[str(attraction["destination_id"])] += 1

  transport_coverage_by_destination: dict[str, int] = defaultdict(int)
  for hub in destination_hubs:
    transport_coverage_by_destination[str(hub["destination_id"])] += 1

  index_entries = []
  for destination in destinations:
    index_entries.append({
      "placeId": destination["destination_id"],
      "name": destination["destination_name"],
      "country": "India",
      "state": destination["state_ut_name"],
      "label": build_label(destination["destination_name"], destination["state_ut_name"]),
      "source": "india_dataset",
    })

  ranked_destinations = sorted(
    [
      destination for destination in destinations
      if destination.get("latitude") is not None and destination.get("longitude") is not None and normalize_text(destination.get("image_url"))
    ],
    key=lambda destination: (
      transport_coverage_by_destination[str(destination["destination_id"])] > 0,
      attraction_count_by_destination[str(destination["destination_id"])],
      normalize_text(destination["destination_name"]),
    ),
    reverse=True,
  )

  featured_map_entries = []
  seen_states: set[str] = set()
  override_count = 0
  for destination in ranked_destinations:
    state_slug = normalize_text(destination["state_ut_slug"])
    if state_slug in seen_states and len(featured_map_entries) < FEATURED_DESTINATION_LIMIT:
      continue
    destination_slug = normalize_text(destination.get("destination_slug"))
    featured_image = normalize_text(
      FEATURED_DESTINATION_IMAGE_OVERRIDES.get(destination_slug),
      normalize_text(destination.get("image_url")),
    )
    if FEATURED_DESTINATION_IMAGE_OVERRIDES.get(destination_slug):
      override_count += 1
    featured_map_entries.append({
      "id": destination_slug,
      "name": destination["destination_name"],
      "country": "India",
      "state": destination["state_ut_name"],
      "region": "Asia",
      "longitude": destination["longitude"],
      "latitude": destination["latitude"],
      "tagline": truncate_text(destination["description"] or f"Explore {destination['destination_name']} in {destination['state_ut_name']}.", 78),
      "description": destination["description"],
      "image": featured_image,
    })
    seen_states.add(state_slug)
    if len(featured_map_entries) >= FEATURED_DESTINATION_LIMIT:
      break

  log(
    "Built featured map image set",
    featured_count=len(featured_map_entries),
    override_count=override_count,
  )

  generated_header = "// Auto-generated by scripts/buildIndiaTravelData.py. Do not edit manually.\n"
  shared_module_path = output_root / "shared" / "indiaDestinationIndex.generated.js"
  shared_module_path.parent.mkdir(parents=True, exist_ok=True)
  shared_module_path.write_text(
    generated_header + "export const INDIA_DESTINATION_INDEX = " + json.dumps(index_entries, indent=2, ensure_ascii=False) + ";\n",
    encoding="utf-8",
  )

  client_module_path = output_root / "src" / "data" / "indiaFeatured.generated.js"
  client_module_path.parent.mkdir(parents=True, exist_ok=True)
  client_module_path.write_text(
    generated_header +
    "export const INDIA_MAP_DESTINATIONS = " + json.dumps(featured_map_entries, indent=2, ensure_ascii=False) + ";\n\n" +
    "export const INDIA_FEATURED_DESTINATIONS = INDIA_MAP_DESTINATIONS;\n",
    encoding="utf-8",
  )


def write_json_file(path: Path, payload: object) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_csv_file(path: Path, rows: list[dict[str, object]]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  if not rows:
    path.write_text("", encoding="utf-8")
    return
  headers = list(rows[0].keys())
  with path.open("w", encoding="utf-8", newline="") as file_handle:
    writer = csv.DictWriter(file_handle, fieldnames=headers)
    writer.writeheader()
    for row in rows:
      serialized = {}
      for header in headers:
        value = row.get(header)
        if isinstance(value, list):
          serialized[header] = json.dumps(value, ensure_ascii=False)
        elif isinstance(value, dict):
          serialized[header] = json.dumps(value, ensure_ascii=False)
        else:
          serialized[header] = value
      writer.writerow(serialized)


def parse_arguments() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Build reusable India tourism and transport datasets.")
  parser.add_argument(
    "--flight-csv",
    type=Path,
    default=Path("/Users/aggimallaabhishek/Downloads/Main_Flight_Data.csv"),
  )
  parser.add_argument(
    "--flight-overlay-csv",
    type=Path,
    default=Path("/Users/aggimallaabhishek/Downloads/flight_dataset_filled.csv"),
  )
  parser.add_argument(
    "--flight-xlsx",
    type=Path,
    default=Path("/Users/aggimallaabhishek/Downloads/flight_dataset_filled.xlsx"),
  )
  parser.add_argument(
    "--road-csv",
    type=Path,
    default=Path("/Users/aggimallaabhishek/Downloads/roadways_dataset.csv"),
  )
  parser.add_argument(
    "--road-xlsx",
    type=Path,
    default=Path("/Users/aggimallaabhishek/Downloads/roadways_dataset.xlsx"),
  )
  parser.add_argument(
    "--train-csv",
    type=Path,
    default=Path("/Users/aggimallaabhishek/Downloads/train_dataset.csv"),
  )
  parser.add_argument(
    "--train-xlsx",
    type=Path,
    default=Path("/Users/aggimallaabhishek/Downloads/train_dataset.xlsx"),
  )
  parser.add_argument(
    "--refresh-tourism",
    action="store_true",
    help="Ignore existing India tourism JSON files and rescrape official destination pages.",
  )
  parser.add_argument(
    "--output-root",
    type=Path,
    default=Path(__file__).resolve().parents[1],
  )
  return parser.parse_args()


def validate_inputs(args: argparse.Namespace) -> None:
  if not args.flight_csv.exists():
    raise FileNotFoundError(f"Required input file is missing: {args.flight_csv}")

  if not ((args.flight_overlay_csv and args.flight_overlay_csv.exists()) or args.flight_xlsx.exists()):
    raise FileNotFoundError(
      f"Required flight overlay input is missing: {args.flight_overlay_csv} or {args.flight_xlsx}"
    )

  if not ((args.road_csv and args.road_csv.exists()) or args.road_xlsx.exists()):
    raise FileNotFoundError(
      f"Required road input is missing: {args.road_csv} or {args.road_xlsx}"
    )

  if not ((args.train_csv and args.train_csv.exists()) or args.train_xlsx.exists()):
    raise FileNotFoundError(
      f"Required train input is missing: {args.train_csv} or {args.train_xlsx}"
    )


def main() -> int:
  args = parse_arguments()
  validate_inputs(args)

  client = HttpClient()
  output_root = args.output_root
  india_output_dir = output_root / "server" / "data" / "india"
  log("Starting India data build", output_root=str(output_root))

  flight_rows, flight_overlay_rows, road_rows, train_rows = load_transport_rows(args)
  log(
    "Loaded transport inputs",
    flight_csv_rows=len(flight_rows),
    flight_overlay_rows=len(flight_overlay_rows),
    road_rows=len(road_rows),
    train_rows=len(train_rows),
  )

  city_catalog, alias_lookup, city_alias_records = build_transport_city_catalog(
    client,
    flight_rows,
    flight_overlay_rows,
    road_rows,
    train_rows,
  )
  transport_cities = sorted(city_catalog.values(), key=lambda city: city["canonical_name"])

  transport_routes, quarantined_routes = build_transport_routes(
    flight_rows,
    flight_overlay_rows,
    road_rows,
    train_rows,
    city_catalog,
    alias_lookup,
  )
  log(
    "Built cleaned transport routes",
    transport_city_count=len(transport_cities),
    route_count=len(transport_routes),
    quarantined_count=len(quarantined_routes),
  )

  tourism_seed = None if args.refresh_tourism else load_existing_tourism_seed(output_root)
  if tourism_seed:
    log("Reusing existing tourism seed from India data directory")
    destinations, attractions, destination_hubs = build_tourism_datasets_from_seed(
      client,
      city_catalog,
      alias_lookup,
      tourism_seed[0],
      tourism_seed[1],
    )
  else:
    destinations, attractions, destination_hubs = build_tourism_datasets(client, city_catalog, alias_lookup)
  log(
    "Built tourism datasets",
    destination_count=len(destinations),
    attraction_count=len(attractions),
    hub_count=len(destination_hubs),
  )

  write_json_file(india_output_dir / "india_destinations.json", destinations)
  write_json_file(india_output_dir / "india_attractions.json", attractions)
  write_json_file(india_output_dir / "india_transport_cities.json", transport_cities)
  write_json_file(india_output_dir / "india_transport_routes.json", transport_routes)
  write_json_file(india_output_dir / "india_destination_hubs.json", destination_hubs)
  write_json_file(india_output_dir / "india_city_aliases.json", city_alias_records)
  write_json_file(india_output_dir / "india_transport_routes_quarantined.json", quarantined_routes)

  write_csv_file(india_output_dir / "india_destinations.csv", destinations)
  write_csv_file(india_output_dir / "india_attractions.csv", attractions)
  write_csv_file(india_output_dir / "india_transport_cities.csv", transport_cities)
  write_csv_file(india_output_dir / "india_transport_routes.csv", transport_routes)
  write_csv_file(india_output_dir / "india_destination_hubs.csv", destination_hubs)
  write_csv_file(india_output_dir / "india_city_aliases.csv", city_alias_records)
  write_csv_file(india_output_dir / "india_transport_routes_quarantined.csv", quarantined_routes)

  build_generated_client_exports(destinations, attractions, destination_hubs, output_root)
  log("Completed India data build", output_dir=str(india_output_dir))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
