# scripts/rooms/combat_room.gd
extends Node2D

signal room_cleared
signal all_players_downed

const SKELETON_SCENE = preload("res://scenes/enemies/skeleton.tscn")

var _enemies_alive: int = 0

func _ready() -> void:
	if not multiplayer.is_server():
		return
	# Spawn skeletons at each marker
	var markers := $SpawnPoints.get_children()
	var count := mini(6, markers.size())
	for i in count:
		_spawn_skeleton.rpc(i, markers[i].position)

@rpc("authority", "call_local", "reliable")
func _spawn_skeleton(index: int, spawn_pos: Vector2) -> void:
	var sk := SKELETON_SCENE.instantiate()
	sk.name = "Skeleton%d" % index
	sk.position = spawn_pos
	$Enemies.add_child(sk)
	if multiplayer.is_server():
		_enemies_alive += 1
		sk.tree_exited.connect(_on_enemy_removed)

func _on_enemy_removed() -> void:
	if not multiplayer.is_server():
		return
	_enemies_alive -= 1
	if _enemies_alive <= 0:
		room_cleared.emit()
