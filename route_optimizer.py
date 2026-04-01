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

    shortest_paths = dijkstra(weight_matrix, origin_index)
    mst = prim_mst(weight_matrix)

    return {
        "algorithm": "python-nearest-neighbor-2opt",
        "visitOrder": optimized_order,
        "totalWeight": path_weight(weight_matrix, optimized_order),
        "shortestPathsFromOrigin": shortest_paths["distances"],
        "previous": shortest_paths["previous"],
        "mst": mst,
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
