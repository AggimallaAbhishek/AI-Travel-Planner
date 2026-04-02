#!/usr/bin/env python3

import heapq
import json
import math
import sys


def _to_weight(value, row_index, column_index):
    if row_index == column_index:
        return 0.0

    if value is None:
        return math.inf

    try:
        weight = float(value)
    except (TypeError, ValueError):
        return math.inf

    if weight < 0:
        return math.inf

    return weight


def normalize_weight_matrix(matrix):
    normalized = []

    for row_index, row in enumerate(matrix or []):
        normalized.append(
            [
                _to_weight(value, row_index, column_index)
                for column_index, value in enumerate(row or [])
            ]
        )

    return normalized


def dijkstra(weight_matrix, start_index):
    distances = [math.inf] * len(weight_matrix)
    previous = [None] * len(weight_matrix)
    distances[start_index] = 0.0
    queue = [(0.0, start_index)]

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


def prim_mst(weight_matrix):
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
        edges.append(
            {
                "fromIndex": from_index,
                "toIndex": to_index,
                "weight": weight,
            }
        )

    return {
        "totalWeight": total_weight,
        "edges": edges,
    }


def path_weight(weight_matrix, order):
    total = 0.0

    for index in range(len(order) - 1):
        from_index = order[index]
        to_index = order[index + 1]
        weight = weight_matrix[from_index][to_index]

        if not math.isfinite(weight):
            return math.inf

        total += weight

    return total


def nearest_neighbor_path(weight_matrix, origin_index, destination_index=None):
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


def two_opt_path(weight_matrix, order, fixed_start=True, fixed_end=True):
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


def normalize_coordinate(value):
    if not isinstance(value, dict):
        return None

    latitude = value.get("latitude", value.get("lat"))
    longitude = value.get("longitude", value.get("lng"))

    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        return None

    if not (math.isfinite(latitude) and math.isfinite(longitude)):
        return None

    return (latitude, longitude)


def squared_distance(left, right):
    if left is None or right is None:
        return math.inf

    latitude_delta = left[0] - right[0]
    longitude_delta = left[1] - right[1]
    return latitude_delta * latitude_delta + longitude_delta * longitude_delta


def cluster_coordinates(node_coordinates, cluster_count):
    coordinates = [normalize_coordinate(item) for item in node_coordinates]
    node_count = len(coordinates)
    if node_count == 0:
        return {}, []

    if cluster_count <= 1:
        return {index: 0 for index in range(node_count)}, [coordinates[0]]

    valid_indices = [index for index, coordinate in enumerate(coordinates) if coordinate is not None]
    if not valid_indices:
        return {index: index % cluster_count for index in range(node_count)}, []

    cluster_count = max(1, min(cluster_count, len(valid_indices)))
    stride = max(1, len(valid_indices) // cluster_count)
    centroid_indices = [valid_indices[min(index * stride, len(valid_indices) - 1)] for index in range(cluster_count)]
    centroids = [coordinates[index] for index in centroid_indices]

    assignments = {}

    for _ in range(24):
        next_assignments = {}

        for node_index, coordinate in enumerate(coordinates):
            if coordinate is None:
                next_assignments[node_index] = node_index % cluster_count
                continue

            best_cluster_id = min(
                range(cluster_count),
                key=lambda cluster_id: squared_distance(coordinate, centroids[cluster_id]),
            )
            next_assignments[node_index] = best_cluster_id

        if next_assignments == assignments:
            break

        assignments = next_assignments
        cluster_buckets = {cluster_id: [] for cluster_id in range(cluster_count)}

        for node_index, cluster_id in assignments.items():
            coordinate = coordinates[node_index]
            if coordinate is None:
                continue
            cluster_buckets[cluster_id].append(coordinate)

        next_centroids = []
        for cluster_id in range(cluster_count):
            bucket = cluster_buckets[cluster_id]
            if not bucket:
                next_centroids.append(centroids[cluster_id])
                continue

            latitude_mean = sum(item[0] for item in bucket) / len(bucket)
            longitude_mean = sum(item[1] for item in bucket) / len(bucket)
            next_centroids.append((latitude_mean, longitude_mean))

        centroids = next_centroids

    if not assignments:
        assignments = {index: index % cluster_count for index in range(node_count)}

    return assignments, centroids


def build_clusters(assignments, cluster_count):
    if cluster_count <= 0:
        return []

    clusters = []
    for cluster_id in range(cluster_count):
        members = sorted(
            [node_index for node_index, assigned_cluster_id in assignments.items() if assigned_cluster_id == cluster_id]
        )
        clusters.append(
            {
                "clusterId": cluster_id,
                "members": members,
            }
        )

    return clusters


def build_day_plans(visit_order, assignments, cluster_count):
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


def optimize_route(payload):
    weight_matrix = normalize_weight_matrix(payload.get("matrix", []))
    if not weight_matrix:
        raise ValueError("matrix is required")

    origin_index = int(payload.get("originIndex", 0))
    destination_index = payload.get("destinationIndex")
    destination_index = (
        int(destination_index) if destination_index is not None else None
    )

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


def main():
    payload = json.load(sys.stdin)
    result = optimize_route(payload)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # pragma: no cover - CLI surface
        print(
            json.dumps({"error": str(error)}),
            file=sys.stderr,
        )
        sys.exit(1)
