extends Node

# Tracks which peer IDs are connected this session
var connected_players: Array[int] = []

# Per-run data (populated in later milestones)
var floor_number: int = 1
var dungeon_seed: int = 0

func reset_run() -> void:
	connected_players.clear()
	floor_number = 1
	dungeon_seed = randi()
