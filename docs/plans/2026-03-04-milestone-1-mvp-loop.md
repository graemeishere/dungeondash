# Milestone 1 — MVP Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One playable combat room — two classes, skeleton enemies with telegraph AI, downed/revive mechanic, win/lose screens, and a restart loop.

**Architecture:** Room-centric. `game.gd` stays as the networking hub. A new `CombatRoom` scene owns enemies and cleared logic. Players are `Warrior`/`Mage` scenes sharing a `PlayerBase` script. A `HealthComponent` child node handles HP for both players and enemies. All enemy logic and damage authority lives on the host.

**Tech Stack:** Godot 4.3+, GDScript, ENetMultiplayerPeer, MultiplayerSynchronizer, CharacterBody2D, Area2D (hitboxes), Kenney "Tiny Dungeon" tileset.

---

## Before You Start

- Download **Kenney Tiny Dungeon** from kenney.nl (free). You will need it for Task 8.
- All paths are relative to the project root: `C:\Users\graem\Projects\dungeondash\`
- Existing files being modified: `project.godot`, `scripts/autoload/game_state.gd`, `scripts/game.gd`, `scenes/world/game.tscn`
- `scripts/player.gd` and `scenes/characters/player.tscn` are **replaced** by the new class system — they are no longer used after Task 3.

---

## Task 1: Attack Input + GameState Class Tracking

**Files:**
- Modify: `project.godot`
- Modify: `scripts/autoload/game_state.gd`

**Step 1: Add `attack` input action to `project.godot`**

Open `project.godot` and add the following block to the `[input]` section (Space bar):

```ini
attack={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":32,"physical_keycode":32,"key_label":0,"unicode":32,"location":0,"echo":false,"script":null)
]
}
```

**Step 2: Extend `game_state.gd`**

```gdscript
extends Node

# Tracks which peer IDs are connected this session
var connected_players: Array[int] = []

# Class selection: peer_id -> "warrior" or "mage"
var player_classes: Dictionary = {}

# Per-run data (populated in later milestones)
var floor_number: int = 1
var dungeon_seed: int = 0

func reset_run() -> void:
	connected_players.clear()
	player_classes.clear()
	floor_number = 1
	dungeon_seed = randi()
```

**Step 3: Verify**

Open Godot → Project Settings → Input Map. You should see `attack` listed with Space bar. Check the Autoload tab for GameState.

**Step 4: Commit**

```bash
git add project.godot scripts/autoload/game_state.gd
git commit -m "feat: add attack input mapping and class tracking to GameState"
```

---

## Task 2: HealthComponent

**Files:**
- Create: `scripts/components/health_component.gd`

**Step 1: Create the folder and write the script**

```gdscript
# scripts/components/health_component.gd
extends Node
class_name HealthComponent

signal died
signal health_changed(new_hp: int, max_hp: int)

@export var max_hp: int = 100
var current_hp: int = 100

func _ready() -> void:
	current_hp = max_hp

func take_damage(amount: int) -> void:
	if current_hp <= 0:
		return
	current_hp = maxi(0, current_hp - amount)
	health_changed.emit(current_hp, max_hp)
	if current_hp == 0:
		died.emit()

func heal(amount: int) -> void:
	current_hp = mini(max_hp, current_hp + amount)
	health_changed.emit(current_hp, max_hp)

func is_dead() -> bool:
	return current_hp <= 0

func get_ratio() -> float:
	return float(current_hp) / float(max_hp)
```

**Step 2: Verify**

No scene needed yet. The class will be used in the next task.

**Step 3: Commit**

```bash
git add scripts/components/health_component.gd
git commit -m "feat: add HealthComponent with HP, damage, and heal signals"
```

---

## Task 3: PlayerBase Script

**Files:**
- Create: `scripts/player_base.gd` (replaces `scripts/player.gd` — the old file can remain but is no longer referenced)

This is the shared logic for both Warrior and Mage. Subclass scripts override `_setup_class_visuals()` and `_do_attack()`.

**Step 1: Write `scripts/player_base.gd`**

```gdscript
# scripts/player_base.gd
extends CharacterBody2D
class_name PlayerBase

const SPEED := 200.0
const DOWNED_TIME := 20.0
const REVIVE_DISTANCE := 64.0
const REVIVE_HOLD_TIME := 1.5

# Override these in subclasses
@export var max_hp: int = 100
@export var attack_damage: int = 20
@export var attack_cooldown: float = 0.7

enum State { IDLE, MOVE, ATTACK, HURT, DOWNED }

# Synced to all peers via MultiplayerSynchronizer
var state: int = State.IDLE
var current_hp: int = 100  # synced; managed by owning peer

var _attack_timer: float = 0.0
var _revive_progress: float = 0.0

@onready var sprite: ColorRect = $ColorRect
@onready var name_label: Label = $NameLabel
@onready var health: HealthComponent = $HealthComponent

func _ready() -> void:
	var peer_id := int(name)
	set_multiplayer_authority(peer_id)
	health.max_hp = max_hp
	health.current_hp = max_hp
	current_hp = max_hp
	health.died.connect(_on_health_depleted)
	health.health_changed.connect(_on_health_changed)
	_setup_class_visuals()

func _setup_class_visuals() -> void:
	pass  # Overridden by Warrior / Mage

func _physics_process(delta: float) -> void:
	if not is_multiplayer_authority():
		return
	match state:
		State.IDLE, State.MOVE:
			_handle_movement()
			_handle_attack_input(delta)
			_handle_revive_input(delta)
		State.ATTACK:
			_attack_timer -= delta
			if _attack_timer <= 0.0:
				state = State.IDLE
		State.DOWNED:
			_revive_progress = 0.0

func _handle_movement() -> void:
	var dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	velocity = dir * SPEED
	move_and_slide()
	state = State.MOVE if dir.length() > 0.1 else State.IDLE

func _handle_attack_input(delta: float) -> void:
	_attack_timer -= delta
	if Input.is_action_just_pressed("attack") and _attack_timer <= 0.0:
		_do_attack()
		_attack_timer = attack_cooldown

func _do_attack() -> void:
	pass  # Overridden by subclass

func _handle_revive_input(delta: float) -> void:
	# Find a nearby downed teammate and hold attack to revive
	var players_node := get_parent()
	if players_node == null:
		return
	for player in players_node.get_children():
		if player == self or not player is PlayerBase:
			continue
		if player.state != State.DOWNED:
			continue
		if global_position.distance_to(player.global_position) <= REVIVE_DISTANCE:
			if Input.is_action_pressed("attack"):
				_revive_progress += delta
				if _revive_progress >= REVIVE_HOLD_TIME:
					_revive_progress = 0.0
					# Ask host to revive the downed player
					_request_revive.rpc_id(1, int(player.name))
			else:
				_revive_progress = 0.0
			return
	_revive_progress = 0.0

func _on_health_depleted() -> void:
	if not is_multiplayer_authority():
		return
	current_hp = 0
	_set_downed.rpc()

func _on_health_changed(new_hp: int, _max: int) -> void:
	current_hp = new_hp

# ── RPC calls ────────────────────────────────────────────────────────────────

@rpc("any_peer", "call_local", "reliable")
func _set_downed() -> void:
	state = State.DOWNED
	sprite.color = Color(0.35, 0.35, 0.35, 0.8)

@rpc("any_peer", "call_local", "reliable")
func _request_revive(downed_peer_id: int) -> void:
	# Only host processes revive requests
	if not multiplayer.is_server():
		return
	var players_node := get_parent()
	var downed := players_node.get_node_or_null(str(downed_peer_id)) as PlayerBase
	if downed != null and downed.state == State.DOWNED:
		downed._do_revive.rpc()

@rpc("authority", "call_local", "reliable")
func _do_revive() -> void:
	state = State.IDLE
	var revive_hp := max_hp / 2
	health.heal(revive_hp)
	current_hp = health.current_hp
	_setup_class_visuals()  # restore colour

# Called by host when an enemy hitbox overlaps this player's hurtbox
@rpc("authority", "call_local", "reliable")
func receive_damage(amount: int) -> void:
	if not is_multiplayer_authority():
		return
	health.take_damage(amount)
```

**Step 2: Commit**

```bash
git add scripts/player_base.gd
git commit -m "feat: add PlayerBase with state machine, downed/revive, and damage RPC"
```

---

## Task 4: Warrior Class

**Files:**
- Create: `scripts/warrior.gd`
- Create: `scenes/characters/warrior.tscn`

**Step 1: Write `scripts/warrior.gd`**

```gdscript
# scripts/warrior.gd
extends PlayerBase

func _setup_class_visuals() -> void:
	sprite.color = Color.CORNFLOWER_BLUE
	name_label.text = "W" if int(name) == 1 else "W2"
	max_hp = 120
	attack_damage = 25
	attack_cooldown = 0.6
	health.max_hp = max_hp
	health.current_hp = max_hp
	current_hp = max_hp

func _do_attack() -> void:
	state = State.ATTACK
	_attack_timer = 0.25  # attack animation duration
	# Enable hitbox for one physics frame via deferred call
	var hitbox := $AttackHitbox as Area2D
	hitbox.monitoring = true
	# Check overlapping areas immediately (areas already in range)
	for area in hitbox.get_overlapping_areas():
		_try_damage_enemy(area)
	# Disable after brief window
	await get_tree().create_timer(0.1).timeout
	hitbox.monitoring = false

func _try_damage_enemy(area: Area2D) -> void:
	var enemy := area.get_parent()
	if enemy.has_method("receive_damage_rpc"):
		# Send damage to host
		enemy.receive_damage_rpc.rpc_id(1, attack_damage)
```

**Step 2: Write `scenes/characters/warrior.tscn`**

```
[gd_scene load_steps=5 format=3]

[ext_resource type="Script" path="res://scripts/warrior.gd" id="1"]
[ext_resource type="Script" path="res://scripts/components/health_component.gd" id="2"]

[sub_resource type="RectangleShape2D" id="RectangleShape2D_1"]
size = Vector2(40, 40)

[sub_resource type="RectangleShape2D" id="RectangleShape2D_2"]
size = Vector2(60, 40)

[sub_resource type="SceneReplicationConfig" id="SceneReplicationConfig_1"]
properties/0/path = NodePath(".:position")
properties/0/spawn = true
properties/0/replication_mode = 2
properties/1/path = NodePath(".:state")
properties/1/spawn = true
properties/1/replication_mode = 2
properties/2/path = NodePath(".:current_hp")
properties/2/spawn = true
properties/2/replication_mode = 2

[node name="Warrior" type="CharacterBody2D"]
script = ExtResource("1")

[node name="ColorRect" type="ColorRect" parent="."]
offset_left = -20.0
offset_top = -20.0
offset_right = 20.0
offset_bottom = 20.0
color = Color(0.392157, 0.584314, 0.929412, 1)

[node name="CollisionShape2D" type="CollisionShape2D" parent="."]
shape = SubResource("RectangleShape2D_1")

[node name="NameLabel" type="Label" parent="."]
offset_left = -20.0
offset_top = -40.0
offset_right = 20.0
offset_bottom = -20.0
horizontal_alignment = 1

[node name="HealthComponent" type="Node" parent="."]
script = ExtResource("2")
max_hp = 120

[node name="AttackHitbox" type="Area2D" parent="."]
monitoring = false
monitorable = false

[node name="AttackHitboxShape" type="CollisionShape2D" parent="AttackHitbox"]
position = Vector2(40, 0)
shape = SubResource("RectangleShape2D_2")

[node name="MultiplayerSynchronizer" type="MultiplayerSynchronizer" parent="."]
replication_config = SubResource("SceneReplicationConfig_1")
```

**Step 3: Verify**

In Godot, open `warrior.tscn`. Run it standalone (set as main scene temporarily). A blue square should appear. WASD moves it. Space should trigger the attack state (square doesn't visually change yet — that's fine).

**Step 4: Commit**

```bash
git add scripts/warrior.gd scenes/characters/warrior.tscn
git commit -m "feat: add Warrior class with melee hitbox attack"
```

---

## Task 5: Mage + MagicBolt

**Files:**
- Create: `scripts/mage.gd`
- Create: `scripts/magic_bolt.gd`
- Create: `scenes/characters/mage.tscn`
- Create: `scenes/characters/magic_bolt.tscn`

**Step 1: Write `scripts/magic_bolt.gd`**

```gdscript
# scripts/magic_bolt.gd
extends CharacterBody2D

const SPEED := 400.0
const MAX_DISTANCE := 800.0

var damage: int = 15
var direction: Vector2 = Vector2.RIGHT
var _distance_travelled: float = 0.0

func _ready() -> void:
	# Bolt only runs on the peer that spawned it (owning peer)
	pass

func _physics_process(delta: float) -> void:
	velocity = direction * SPEED
	var collision := move_and_collide(velocity * delta)
	_distance_travelled += SPEED * delta

	if collision:
		# Hit a wall or something solid
		queue_free()
		return

	if _distance_travelled >= MAX_DISTANCE:
		queue_free()

func _on_hit_area_entered(area: Area2D) -> void:
	var enemy := area.get_parent()
	if enemy.has_method("receive_damage_rpc"):
		enemy.receive_damage_rpc.rpc_id(1, damage)
	queue_free()
```

**Step 2: Write `scenes/characters/magic_bolt.tscn`**

```
[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://scripts/magic_bolt.gd" id="1"]

[sub_resource type="RectangleShape2D" id="RectangleShape2D_1"]
size = Vector2(12, 8)

[node name="MagicBolt" type="CharacterBody2D"]
script = ExtResource("1")

[node name="ColorRect" type="ColorRect" parent="."]
offset_left = -6.0
offset_top = -4.0
offset_right = 6.0
offset_bottom = 4.0
color = Color(0.8, 0.4, 1.0, 1)

[node name="CollisionShape2D" type="CollisionShape2D" parent="."]
shape = SubResource("RectangleShape2D_1")

[node name="HitArea" type="Area2D" parent="."]
monitoring = true
monitorable = false

[node name="HitAreaShape" type="CollisionShape2D" parent="HitArea"]
shape = SubResource("RectangleShape2D_1")

[connection signal="area_entered" from="HitArea" to="." method="_on_hit_area_entered"]
```

**Step 3: Write `scripts/mage.gd`**

```gdscript
# scripts/mage.gd
extends PlayerBase

const BOLT_SCENE = preload("res://scenes/characters/magic_bolt.tscn")

var _last_direction := Vector2.RIGHT

func _setup_class_visuals() -> void:
	sprite.color = Color(0.6, 0.2, 0.8)
	name_label.text = "M" if int(name) == 1 else "M2"
	max_hp = 70
	attack_damage = 15
	attack_cooldown = 0.8
	health.max_hp = max_hp
	health.current_hp = max_hp
	current_hp = max_hp

func _handle_movement() -> void:
	var dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	velocity = dir * SPEED
	move_and_slide()
	if dir.length() > 0.1:
		_last_direction = dir.normalized()
		state = State.MOVE
	else:
		state = State.IDLE

func _do_attack() -> void:
	state = State.ATTACK
	_attack_timer = 0.3
	var bolt := BOLT_SCENE.instantiate() as CharacterBody2D
	bolt.direction = _last_direction
	bolt.damage = attack_damage
	bolt.position = global_position + _last_direction * 30.0
	# Add bolt to the same parent as players (World/Players node's parent)
	get_parent().get_parent().add_child(bolt)
```

**Step 4: Write `scenes/characters/mage.tscn`**

Copy the structure from `warrior.tscn` but with:
- Script → `res://scripts/mage.gd`
- No AttackHitbox node (remove it)
- ColorRect default colour `Color(0.6, 0.2, 0.8)`
- HealthComponent max_hp = 70

```
[gd_scene load_steps=4 format=3]

[ext_resource type="Script" path="res://scripts/mage.gd" id="1"]
[ext_resource type="Script" path="res://scripts/components/health_component.gd" id="2"]

[sub_resource type="RectangleShape2D" id="RectangleShape2D_1"]
size = Vector2(40, 40)

[sub_resource type="SceneReplicationConfig" id="SceneReplicationConfig_1"]
properties/0/path = NodePath(".:position")
properties/0/spawn = true
properties/0/replication_mode = 2
properties/1/path = NodePath(".:state")
properties/1/spawn = true
properties/1/replication_mode = 2
properties/2/path = NodePath(".:current_hp")
properties/2/spawn = true
properties/2/replication_mode = 2

[node name="Mage" type="CharacterBody2D"]
script = ExtResource("1")

[node name="ColorRect" type="ColorRect" parent="."]
offset_left = -20.0
offset_top = -20.0
offset_right = 20.0
offset_bottom = 20.0
color = Color(0.6, 0.2, 0.8, 1)

[node name="CollisionShape2D" type="CollisionShape2D" parent="."]
shape = SubResource("RectangleShape2D_1")

[node name="NameLabel" type="Label" parent="."]
offset_left = -20.0
offset_top = -40.0
offset_right = 20.0
offset_bottom = -20.0
horizontal_alignment = 1

[node name="HealthComponent" type="Node" parent="."]
script = ExtResource("2")
max_hp = 70

[node name="MultiplayerSynchronizer" type="MultiplayerSynchronizer" parent="."]
replication_config = SubResource("SceneReplicationConfig_1")
```

**Step 5: Commit**

```bash
git add scripts/mage.gd scripts/magic_bolt.gd scenes/characters/mage.tscn scenes/characters/magic_bolt.tscn
git commit -m "feat: add Mage class and MagicBolt projectile"
```

---

## Task 6: Skeleton Enemy

**Files:**
- Create: `scripts/enemies/skeleton.gd`
- Create: `scenes/enemies/skeleton.tscn`

**Step 1: Write `scripts/enemies/skeleton.gd`**

The skeleton runs entirely on the host. Its position and state are synced to the guest.

```gdscript
# scripts/enemies/skeleton.gd
extends CharacterBody2D

const SPEED := 80.0
const ATTACK_RANGE := 48.0
const ATTACK_DAMAGE := 15
const TELEGRAPH_TIME := 0.5
const ATTACK_DURATION := 0.15
const COOLDOWN_TIME := 1.0
const HURT_TIME := 0.2

enum State { IDLE, CHASE, TELEGRAPH, ATTACK, COOLDOWN, HURT, DEAD }

# Synced to guest
var state: int = State.IDLE
var current_hp: int = 40

var _state_timer: float = 0.0
var _target: Node2D = null

@onready var sprite: ColorRect = $ColorRect
@onready var health: Node = $HealthComponent  # HealthComponent
@onready var hitbox: Area2D = $AttackHitbox

func _ready() -> void:
	# Skeletons are always host-authoritative
	health.max_hp = 40
	health.current_hp = 40
	current_hp = 40
	health.died.connect(_on_died)
	health.health_changed.connect(func(hp, _m): current_hp = hp)
	if not multiplayer.is_server():
		set_physics_process(false)

func _physics_process(delta: float) -> void:
	_state_timer -= delta
	match state:
		State.IDLE:
			_find_target()
			if _target:
				state = State.CHASE
		State.CHASE:
			_chase_target()
		State.TELEGRAPH:
			sprite.color = Color.RED
			if _state_timer <= 0.0:
				_enter_attack()
		State.ATTACK:
			if _state_timer <= 0.0:
				_exit_attack()
		State.COOLDOWN:
			sprite.color = Color(0.8, 0.6, 0.4)
			if _state_timer <= 0.0:
				state = State.CHASE
		State.HURT:
			sprite.color = Color.WHITE
			if _state_timer <= 0.0:
				sprite.color = Color(0.8, 0.6, 0.4)
				state = State.CHASE

func _find_target() -> void:
	var players_node := get_tree().get_first_node_in_group("players")
	if players_node == null:
		return
	var closest_dist := INF
	for player in players_node.get_children():
		if not player is CharacterBody2D:
			continue
		var d := global_position.distance_to(player.global_position)
		if d < closest_dist:
			closest_dist = d
			_target = player

func _chase_target() -> void:
	if _target == null or not is_instance_valid(_target):
		_target = null
		state = State.IDLE
		return
	var dist := global_position.distance_to(_target.global_position)
	if dist <= ATTACK_RANGE:
		_enter_telegraph()
	else:
		var dir := (_target.global_position - global_position).normalized()
		velocity = dir * SPEED
		move_and_slide()
		sprite.color = Color(0.8, 0.6, 0.4)

func _enter_telegraph() -> void:
	state = State.TELEGRAPH
	_state_timer = TELEGRAPH_TIME
	velocity = Vector2.ZERO

func _enter_attack() -> void:
	state = State.ATTACK
	_state_timer = ATTACK_DURATION
	hitbox.monitoring = true
	sprite.color = Color.DARK_RED
	# Damage any player currently overlapping the hitbox
	for area in hitbox.get_overlapping_areas():
		var player := area.get_parent()
		if player.has_method("receive_damage"):
			player.receive_damage.rpc(ATTACK_DAMAGE)

func _exit_attack() -> void:
	hitbox.monitoring = false
	state = State.COOLDOWN
	_state_timer = COOLDOWN_TIME

func _on_died() -> void:
	state = State.DEAD
	sprite.color = Color(0.2, 0.2, 0.2, 0.5)
	set_physics_process(false)
	await get_tree().create_timer(0.5).timeout
	queue_free()

# Called via RPC from owning peer when a player hitbox connects
func receive_damage_rpc(amount: int) -> void:
	if not multiplayer.is_server():
		return
	health.take_damage(amount)
	if state != State.DEAD:
		state = State.HURT
		_state_timer = HURT_TIME
```

**Step 2: Write `scenes/enemies/skeleton.tscn`**

```
[gd_scene load_steps=5 format=3]

[ext_resource type="Script" path="res://scripts/enemies/skeleton.gd" id="1"]
[ext_resource type="Script" path="res://scripts/components/health_component.gd" id="2"]

[sub_resource type="RectangleShape2D" id="RectangleShape2D_1"]
size = Vector2(36, 36)

[sub_resource type="RectangleShape2D" id="RectangleShape2D_2"]
size = Vector2(48, 48)

[sub_resource type="SceneReplicationConfig" id="SceneReplicationConfig_1"]
properties/0/path = NodePath(".:position")
properties/0/spawn = true
properties/0/replication_mode = 2
properties/1/path = NodePath(".:state")
properties/1/spawn = true
properties/1/replication_mode = 2

[node name="Skeleton" type="CharacterBody2D"]
script = ExtResource("1")

[node name="ColorRect" type="ColorRect" parent="."]
offset_left = -18.0
offset_top = -18.0
offset_right = 18.0
offset_bottom = 18.0
color = Color(0.8, 0.6, 0.4, 1)

[node name="CollisionShape2D" type="CollisionShape2D" parent="."]
shape = SubResource("RectangleShape2D_1")

[node name="HealthComponent" type="Node" parent="."]
script = ExtResource("2")
max_hp = 40

[node name="AttackHitbox" type="Area2D" parent="."]
monitoring = false
monitorable = false

[node name="AttackHitboxShape" type="CollisionShape2D" parent="AttackHitbox"]
shape = SubResource("RectangleShape2D_2")

[node name="Hurtbox" type="Area2D" parent="."]
monitoring = false
monitorable = true

[node name="HurtboxShape" type="CollisionShape2D" parent="Hurtbox"]
shape = SubResource("RectangleShape2D_1")

[node name="MultiplayerSynchronizer" type="MultiplayerSynchronizer" parent="."]
replication_config = SubResource("SceneReplicationConfig_1")
```

**Step 3: Commit**

```bash
git add scripts/enemies/skeleton.gd scenes/enemies/skeleton.tscn
git commit -m "feat: add Skeleton enemy with chase/telegraph/attack AI"
```

---

## Task 7: CombatRoom Script + Scene Shell

**Files:**
- Create: `scripts/rooms/combat_room.gd`
- Create: `scenes/rooms/combat_room.tscn`

**Step 1: Write `scripts/rooms/combat_room.gd`**

```gdscript
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
```

**Step 2: Write `scenes/rooms/combat_room.tscn`**

This creates the scene shell. The TileMap and spawn points are added manually in the editor (Task 8).

```
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/rooms/combat_room.gd" id="1"]

[node name="CombatRoom" type="Node2D"]
script = ExtResource("1")

[node name="TileMap" type="TileMap" parent="."]

[node name="Enemies" type="Node2D" parent="."]

[node name="SpawnPoints" type="Node2D" parent="."]
```

**Step 3: Commit**

```bash
git add scripts/rooms/combat_room.gd scenes/rooms/combat_room.tscn
git commit -m "feat: add CombatRoom with skeleton spawning and room_cleared signal"
```

---

## Task 8: TileMap Setup (Editor — Manual Step)

This task is done entirely in the Godot editor. No code is written.

**Prerequisites:** Download Kenney Tiny Dungeon pack from kenney.nl. Extract and copy the spritesheet PNG into `assets/tilesets/`.

**Step 1: Import the tileset spritesheet**

Drag the PNG into Godot's FileSystem panel → it auto-imports.

**Step 2: Create a TileSet resource**

1. Open `scenes/rooms/combat_room.tscn`
2. Select the `TileMap` node
3. In Inspector: TileSet → New TileSet
4. Click the TileSet → open TileSet editor panel at the bottom
5. Drag your spritesheet PNG into the TileSet editor
6. Godot will detect individual tiles — confirm the tile size (Tiny Dungeon = 16×16)
7. Set TileMap → Cell Size to `Vector2(32, 32)` (2× scale for visibility)

**Step 3: Paint the arena**

Select the TileMap node, switch to the TileMap editor tab. Paint a room:
- Roughly 20×14 tiles
- Stone floor tiles filling the interior
- Wall tiles around the border (use a physics layer with collision on wall tiles)
- 3–4 pillar obstacles inside for cover

To add collision to wall tiles: in the TileSet editor, select a wall tile → Physics → Add physics layer → draw the collision polygon.

**Step 4: Add spawn point Markers**

1. Select `SpawnPoints` node
2. Add 6 `Marker2D` child nodes (right-click → Add Child Node → Marker2D)
3. Position them at room corners and midpoints, away from walls
4. Name them `Spawn0` through `Spawn5`

**Step 5: Add players group**

In `game.gd`'s `_spawn_player` function (updated in Task 11), the Players node needs to be in the "players" group so skeletons can find it. Add this to `game.gd`'s `_ready()`:
```gdscript
$World/Players.add_to_group("players")
```

Wait — skeletons search `get_tree().get_first_node_in_group("players")` — but that returns the **group node itself**, not the players. Fix: skeletons should search for the individual player nodes via group, or search for `CharacterBody2D` children.

Actually simpler: change skeleton.gd's `_find_target()` to search all nodes in the "player" group directly:

```gdscript
func _find_target() -> void:
	var closest_dist := INF
	for player in get_tree().get_nodes_in_group("player"):
		var d := global_position.distance_to(player.global_position)
		if d < closest_dist:
			closest_dist = d
			_target = player
```

Then in `player_base.gd`'s `_ready()`, add:
```gdscript
add_to_group("player")
```

Update `scripts/player_base.gd` and `scripts/enemies/skeleton.gd` with these group changes.

**Step 6: Commit editor changes**

```bash
git add scenes/rooms/combat_room.tscn assets/tilesets/ scripts/player_base.gd scripts/enemies/skeleton.gd
git commit -m "feat: set up TileMap arena and player group for skeleton targeting"
```

---

## Task 9: ClassSelect UI

**Files:**
- Create: `scripts/ui/class_select.gd`
- Create: `scenes/ui/class_select.tscn`

**Step 1: Write `scripts/ui/class_select.gd`**

```gdscript
# scripts/ui/class_select.gd
extends Control

signal class_selected(peer_id: int, class_name: String)

@onready var warrior_btn: Button = $VBox/WarriorButton
@onready var mage_btn: Button = $VBox/MageButton
@onready var status_label: Label = $VBox/StatusLabel
@onready var waiting_label: Label = $VBox/WaitingLabel

var _my_selection: String = ""

func _ready() -> void:
	waiting_label.visible = false
	status_label.text = "Choose your class:"

func _on_warrior_button_pressed() -> void:
	_pick_class("warrior")

func _on_mage_button_pressed() -> void:
	_pick_class("mage")

func _pick_class(class_name: String) -> void:
	_my_selection = class_name
	warrior_btn.disabled = true
	mage_btn.disabled = true
	status_label.text = "Picked: %s" % class_name.capitalize()
	waiting_label.visible = true
	waiting_label.text = "Waiting for other player..." if not multiplayer.is_server() else "Waiting..."
	# Send selection to host (or process locally if solo/host)
	_submit_class.rpc_id(1, multiplayer.get_unique_id(), class_name)

@rpc("any_peer", "call_local", "reliable")
func _submit_class(peer_id: int, chosen_class: String) -> void:
	# Only host processes this
	if not multiplayer.is_server():
		return
	GameState.player_classes[peer_id] = chosen_class
	# Check if all connected peers have selected
	var all_selected := true
	for pid in GameState.connected_players:
		if not GameState.player_classes.has(pid):
			all_selected = false
			break
	if all_selected:
		_start_game.rpc()

@rpc("authority", "call_local", "reliable")
func _start_game() -> void:
	# Notify game.gd to begin
	get_tree().get_root().get_node("Game").begin_run()
```

**Step 2: Write `scenes/ui/class_select.tscn`**

```
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/ui/class_select.gd" id="1"]

[node name="ClassSelect" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
visible = false
script = ExtResource("1")

[node name="VBox" type="VBoxContainer" parent="."]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -150.0
offset_top = -100.0
offset_right = 150.0
offset_bottom = 100.0
theme_override_constants/separation = 16

[node name="Title" type="Label" parent="VBox"]
text = "Choose Your Class"
horizontal_alignment = 1
theme_override_font_sizes/font_size = 24

[node name="StatusLabel" type="Label" parent="VBox"]
text = "Choose your class:"
horizontal_alignment = 1

[node name="WarriorButton" type="Button" parent="VBox"]
text = "Warrior  (Melee — 120 HP)"

[node name="MageButton" type="Button" parent="VBox"]
text = "Mage  (Ranged — 70 HP)"

[node name="WaitingLabel" type="Label" parent="VBox"]
text = "Waiting..."
horizontal_alignment = 1
visible = false

[connection signal="pressed" from="VBox/WarriorButton" to="." method="_on_warrior_button_pressed"]
[connection signal="pressed" from="VBox/MageButton" to="." method="_on_mage_button_pressed"]
```

**Step 3: Commit**

```bash
git add scripts/ui/class_select.gd scenes/ui/class_select.tscn
git commit -m "feat: add ClassSelect UI with host-coordinated start"
```

---

## Task 10: HUD

**Files:**
- Create: `scripts/ui/hud.gd`
- Create: `scenes/ui/hud.tscn`

**Step 1: Write `scripts/ui/hud.gd`**

```gdscript
# scripts/ui/hud.gd
extends CanvasLayer

@onready var p1_bar: ProgressBar = $HBoxContainer/P1Box/P1HP
@onready var p2_bar: ProgressBar = $HBoxContainer/P2Box/P2HP
@onready var p2_box: VBoxContainer = $HBoxContainer/P2Box
@onready var win_overlay: Control = $WinOverlay
@onready var lose_overlay: Control = $LoseOverlay

func _ready() -> void:
	win_overlay.visible = false
	lose_overlay.visible = false
	p2_box.visible = GameState.connected_players.size() > 1

func update_hp(peer_id: int, hp: int, max_hp: int) -> void:
	var bar := p1_bar if peer_id == 1 else p2_bar
	bar.max_value = max_hp
	bar.value = hp

func show_win() -> void:
	win_overlay.visible = true

func show_lose() -> void:
	lose_overlay.visible = true

func _on_play_again_pressed() -> void:
	get_tree().get_root().get_node("Game").restart_run()

func _on_try_again_pressed() -> void:
	get_tree().get_root().get_node("Game").restart_run()
```

**Step 2: Write `scenes/ui/hud.tscn`**

```
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/ui/hud.gd" id="1"]

[node name="HUD" type="CanvasLayer"]
script = ExtResource("1")

[node name="HBoxContainer" type="HBoxContainer" parent="."]
anchor_right = 1.0
offset_bottom = 60.0
theme_override_constants/separation = 0

[node name="P1Box" type="VBoxContainer" parent="HBoxContainer"]
custom_minimum_size = Vector2(200, 0)

[node name="P1Label" type="Label" parent="HBoxContainer/P1Box"]
text = "P1"

[node name="P1HP" type="ProgressBar" parent="HBoxContainer/P1Box"]
custom_minimum_size = Vector2(180, 20)
max_value = 120
value = 120

[node name="Spacer" type="Control" parent="HBoxContainer"]
size_flags_horizontal = 3

[node name="P2Box" type="VBoxContainer" parent="HBoxContainer"]
custom_minimum_size = Vector2(200, 0)

[node name="P2Label" type="Label" parent="HBoxContainer/P2Box"]
text = "P2"
horizontal_alignment = 2

[node name="P2HP" type="ProgressBar" parent="HBoxContainer/P2Box"]
custom_minimum_size = Vector2(180, 20)
max_value = 70
value = 70

[node name="WinOverlay" type="Control" parent="."]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
visible = false

[node name="WinPanel" type="VBoxContainer" parent="WinOverlay"]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -150.0
offset_top = -80.0
offset_right = 150.0
offset_bottom = 80.0

[node name="WinLabel" type="Label" parent="WinOverlay/WinPanel"]
text = "Floor Cleared!"
horizontal_alignment = 1
theme_override_font_sizes/font_size = 32

[node name="PlayAgainButton" type="Button" parent="WinOverlay/WinPanel"]
text = "Play Again"

[node name="LoseOverlay" type="Control" parent="."]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
visible = false

[node name="LosePanel" type="VBoxContainer" parent="LoseOverlay"]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -150.0
offset_top = -80.0
offset_right = 150.0
offset_bottom = 80.0

[node name="LoseLabel" type="Label" parent="LoseOverlay/LosePanel"]
text = "Both Down — Run Over"
horizontal_alignment = 1
theme_override_font_sizes/font_size = 24

[node name="TryAgainButton" type="Button" parent="LoseOverlay/LosePanel"]
text = "Try Again"

[connection signal="pressed" from="WinOverlay/WinPanel/PlayAgainButton" to="." method="_on_play_again_pressed"]
[connection signal="pressed" from="LoseOverlay/LosePanel/TryAgainButton" to="." method="_on_try_again_pressed"]
```

**Step 3: Commit**

```bash
git add scripts/ui/hud.gd scenes/ui/hud.tscn
git commit -m "feat: add HUD with HP bars and win/lose overlays"
```

---

## Task 11: Rewire game.gd for M1 Flow

**Files:**
- Modify: `scripts/game.gd`
- Modify: `scenes/world/game.tscn`

This is the largest task. `game.gd` gains class-aware spawning, room loading, downed tracking, and the run lifecycle.

**Step 1: Write the full updated `scripts/game.gd`**

```gdscript
# scripts/game.gd
extends Node

const PORT = 7777
const MAX_PEERS = 1
const WARRIOR_SCENE = preload("res://scenes/characters/warrior.tscn")
const MAGE_SCENE    = preload("res://scenes/characters/mage.tscn")
const ROOM_SCENE    = preload("res://scenes/rooms/combat_room.tscn")

@onready var players_node: Node2D   = $World/Players
@onready var world_node: Node2D     = $World
@onready var main_menu: Control     = $UI/MainMenu
@onready var class_select: Control  = $UI/ClassSelect
@onready var hud: CanvasLayer       = $HUD

var _room: Node2D = null
var _downed_players: Array[int] = []

func _ready() -> void:
	players_node.add_to_group("players")
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected_to_server)
	multiplayer.connection_failed.connect(_on_connection_failed)

# ── Hosting / Joining ─────────────────────────────────────────────────────────

func host_game() -> void:
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_server(PORT, MAX_PEERS)
	if error != OK:
		main_menu.set_status("Failed to create server (error %d)" % error)
		return
	multiplayer.multiplayer_peer = peer
	GameState.connected_players.append(1)
	_show_class_select()

func join_game(ip: String) -> void:
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_client(ip, PORT)
	if error != OK:
		main_menu.set_status("Failed to connect (error %d)" % error)
		return
	multiplayer.multiplayer_peer = peer

func _show_class_select() -> void:
	main_menu.visible = false
	class_select.visible = true

# ── Multiplayer Callbacks ─────────────────────────────────────────────────────

func _on_peer_connected(id: int) -> void:
	if not multiplayer.is_server():
		return
	GameState.connected_players.append(id)
	main_menu.set_status("Guest connected!")

func _on_peer_disconnected(id: int) -> void:
	GameState.connected_players.erase(id)
	var player := players_node.get_node_or_null(str(id))
	if player:
		player.queue_free()

func _on_connected_to_server() -> void:
	_show_class_select_rpc.rpc_id(multiplayer.get_unique_id())

func _on_connection_failed() -> void:
	main_menu.set_status("Connection failed. Check the IP and try again.")

@rpc("authority", "call_local", "reliable")
func _show_class_select_rpc(_peer_id: int) -> void:
	_show_class_select()

# ── Run Lifecycle ─────────────────────────────────────────────────────────────

func begin_run() -> void:
	# Called by ClassSelect on all peers after all classes chosen
	class_select.visible = false
	_load_room.rpc()

@rpc("authority", "call_local", "reliable")
func _load_room() -> void:
	if _room != null:
		_room.queue_free()
	_room = ROOM_SCENE.instantiate()
	world_node.add_child(_room)
	if multiplayer.is_server():
		_room.room_cleared.connect(_on_room_cleared)
	# Spawn players
	for pid in GameState.connected_players:
		_spawn_player(pid)

func _spawn_player(peer_id: int) -> void:
	if players_node.get_node_or_null(str(peer_id)) != null:
		return
	var chosen := GameState.player_classes.get(peer_id, "warrior")
	var player := WARRIOR_SCENE.instantiate() if chosen == "warrior" else MAGE_SCENE.instantiate()
	player.name = str(peer_id)
	player.position = Vector2(300.0, 360.0) if peer_id == 1 else Vector2(500.0, 360.0)
	players_node.add_child(player)
	# Wire health updates to HUD
	player.health.health_changed.connect(func(hp, mx): hud.update_hp(peer_id, hp, mx))
	# Watch for downed state to check run-over condition
	if multiplayer.is_server():
		player._set_downed.connect(_on_player_downed.bind(peer_id), CONNECT_ONE_SHOT)

func _on_room_cleared() -> void:
	_show_win.rpc()

@rpc("authority", "call_local", "reliable")
func _show_win() -> void:
	hud.show_win()

func _on_player_downed(peer_id: int) -> void:
	if not _downed_players.has(peer_id):
		_downed_players.append(peer_id)
	# Re-connect in case they get revived and downed again
	var player := players_node.get_node_or_null(str(peer_id))
	if player:
		player._set_downed.connect(_on_player_downed.bind(peer_id), CONNECT_ONE_SHOT)
	# Check if all players are down
	var all_down := true
	for pid in GameState.connected_players:
		var p := players_node.get_node_or_null(str(pid)) as PlayerBase
		if p != null and p.state != PlayerBase.State.DOWNED:
			all_down = false
			break
	if all_down:
		_game_over.rpc()

@rpc("authority", "call_local", "reliable")
func _game_over() -> void:
	hud.show_lose()

func restart_run() -> void:
	# Clear everything and return to class select
	for child in players_node.get_children():
		child.queue_free()
	if _room != null:
		_room.queue_free()
		_room = null
	_downed_players.clear()
	GameState.reset_run()
	GameState.connected_players.append(multiplayer.get_unique_id())
	# Re-show class select on all peers
	_reset_to_class_select.rpc()

@rpc("authority", "call_local", "reliable")
func _reset_to_class_select() -> void:
	hud.win_overlay.visible = false
	hud.lose_overlay.visible = false
	class_select.visible = true
	class_select._my_selection = ""
	class_select.warrior_btn.disabled = false
	class_select.mage_btn.disabled = false
	class_select.waiting_label.visible = false
	class_select.status_label.text = "Choose your class:"
```

**Note on `_set_downed.connect`:** `_set_downed` is an RPC method, which in Godot 4 is callable as a signal via `Callable`. However, directly connecting to it may not work. An alternative: add a `downed` signal to `PlayerBase` and emit it inside `_set_downed()`. Update `player_base.gd`:

```gdscript
# Add near the top of player_base.gd
signal downed

# Inside _set_downed():
@rpc("any_peer", "call_local", "reliable")
func _set_downed() -> void:
	state = State.DOWNED
	sprite.color = Color(0.35, 0.35, 0.35, 0.8)
	downed.emit()
```

Then in `game.gd`, connect to `player.downed` instead of `player._set_downed`.

**Step 2: Update `scenes/world/game.tscn`**

Add `ClassSelect` and `HUD` scene instances:

```
[gd_scene load_steps=5 format=3]

[ext_resource type="Script" path="res://scripts/game.gd" id="1"]
[ext_resource type="PackedScene" path="res://scenes/ui/main_menu.tscn" id="2"]
[ext_resource type="PackedScene" path="res://scenes/ui/class_select.tscn" id="3"]
[ext_resource type="PackedScene" path="res://scenes/ui/hud.tscn" id="4"]

[node name="Game" type="Node"]
script = ExtResource("1")

[node name="World" type="Node2D" parent="."]

[node name="Players" type="Node2D" parent="World"]

[node name="UI" type="CanvasLayer" parent="."]

[node name="MainMenu" parent="UI" instance=ExtResource("2")]

[node name="ClassSelect" parent="UI" instance=ExtResource("3")]

[node name="HUD" parent="." instance=ExtResource("4")]
```

**Step 3: Verify — Full solo run**

1. Run the project (F5) as solo (no network).
2. Click **Host Game** → ClassSelect appears → pick **Warrior** → game loads.
3. Blue square appears, WASD moves, Space swings.
4. Kill all 6 skeletons → "Floor Cleared!" overlay appears.
5. Click "Play Again" → class select reappears.

**Step 4: Verify — Co-op (two instances)**

1. `Debug → Run Multiple Instances → Run 2 Instances`
2. Instance 1: Host → pick Warrior.
3. Instance 2: Join 127.0.0.1 → pick Mage.
4. Both squares appear. Both players can move and attack.
5. Let skeletons kill one player → "DOWNED" state shown.
6. Other player walks near and holds Space → downed player revives.
7. If both downed → "Both Down — Run Over" → Try Again → back to class select.

**Step 5: Commit**

```bash
git add scripts/game.gd scenes/world/game.tscn scripts/player_base.gd
git commit -m "feat: wire M1 full flow — class select, room, downed/revive, win/lose, restart"
```

---

## Done When

- [ ] Solo: spawn as Warrior or Mage, kill 6 skeletons, win screen shows, restart works
- [ ] Co-op: both players visible and controllable, skeleton enemies chase and telegraph, downed player revived by partner, both down triggers run-over, restart returns to class select
- [ ] No crashes on disconnect during play

## Known M1 Limitations (fix in M2)

- Mage bolts are not synced to the other peer's screen (host won't see guest's bolts visually)
- Background ColorRect does not fill screen (cosmetic)
- No audio
- No sprite art — all placeholder ColorRects
- Android controls not wired (M2)
