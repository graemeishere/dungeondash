# Dungeon Dash — Milestone 0: Multiplayer Proof Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Two colored rectangles (placeholder characters) moving in real time on two Godot editor instances connected over LAN WiFi — proving co-op is viable before any game systems are built.

**Architecture:** Host/client model using Godot 4's built-in ENet networking. Host creates a server on port 7777; guest connects by IP. Characters are spawned via RPC calls, each with `set_multiplayer_authority` so only the owning peer processes input. Position syncs automatically via `MultiplayerSynchronizer`.

**Tech Stack:** Godot 4.3+ (GDScript), ENetMultiplayerPeer, MultiplayerSynchronizer, CharacterBody2D

---

## Before You Start

- **Godot is installed at `C:\Godot`** — the Godot 4 editor executable is `C:\Godot\Godot_v4.x_win64.exe` (confirm exact filename in that folder)
- This plan creates the project files by writing them directly — no need to use Godot's "New Project" wizard
- To test multiplayer: run two instances of Godot editor simultaneously (or run one in editor + one exported)
- All paths are relative to the project root: `/c/Users/graem/Projects/dungeondash/`

---

## Task 1: Project Initialization

**Files:**
- Create: `project.godot`
- Create: `icon.svg`
- Create: `docs/plans/` (already exists)

**Step 1: Write `project.godot`**

```ini
; Engine configuration file.
; It's best edited using the editor UI and not directly,
; since the properties are not all commented or presented nicely.

[application]

config/name="DungeonDash"
run/main_scene="res://scenes/world/game.tscn"
config/features=PackedStringArray("4.3", "GL Compatibility")
config/icon="res://icon.svg"

[autoload]

GameState="*res://scripts/autoload/game_state.gd"

[display]

window/size/viewport_width=1280
window/size/viewport_height=720

[input]

move_left={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":65,"key_label":0,"unicode":97,"location":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":4194319,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)
]
}
move_right={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":68,"key_label":0,"unicode":100,"location":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":4194321,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)
]
}
move_up={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":87,"key_label":0,"unicode":119,"location":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":4194320,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)
]
}
move_down={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":83,"key_label":0,"unicode":115,"location":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":4194322,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)
]
}
```

**Step 2: Write placeholder `icon.svg`**

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
  <rect width="128" height="128" fill="#3d8b3d"/>
  <text x="64" y="80" font-size="48" text-anchor="middle" fill="white">DD</text>
</svg>
```

**Step 3: Create folder structure**

```
scenes/
  characters/
  enemies/
  rooms/
  ui/
  world/
scripts/
  autoload/
assets/
  sprites/
  tilesets/
  audio/
data/
docs/
  plans/
```

Create a `.gitkeep` in each empty leaf folder so git tracks them.

**Step 4: Verify**

Open the `dungeondash/` folder in Godot 4 (File → Open Project → browse to folder). It should open without errors. The main scene warning ("main scene not found") is expected — we haven't created it yet.

---

## Task 2: GameState Autoload

**Files:**
- Create: `scripts/autoload/game_state.gd`

This is a global singleton that holds all run state. For Milestone 0 it just tracks connected peers.

**Step 1: Write `scripts/autoload/game_state.gd`**

```gdscript
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
```

**Step 2: Verify autoload is registered**

`project.godot` already has:
```
[autoload]
GameState="*res://scripts/autoload/game_state.gd"
```

In Godot editor: Project → Project Settings → Autoload tab. You should see `GameState` listed. If not, add it manually pointing to `res://scripts/autoload/game_state.gd`.

---

## Task 3: Player Script & Scene

**Files:**
- Create: `scripts/player.gd`
- Create: `scenes/characters/player.tscn`

The player is a colored square for now — no art needed. Movement is processed only by the peer that owns this player instance.

**Step 1: Write `scripts/player.gd`**

```gdscript
extends CharacterBody2D

const SPEED = 200.0

# Colors to distinguish Player 1 vs Player 2
const PLAYER_COLORS = {
	1: Color.CORNFLOWER_BLUE,
	2: Color.TOMATO,
}

@onready var sprite: ColorRect = $ColorRect
@onready var sync: MultiplayerSynchronizer = $MultiplayerSynchronizer
@onready var name_label: Label = $NameLabel

func _ready() -> void:
	# The node name is set to the peer ID string when spawned
	var peer_id := int(name)
	set_multiplayer_authority(peer_id)

	# Color the square based on player number
	var color_index := 1 if peer_id == 1 else 2
	sprite.color = PLAYER_COLORS.get(color_index, Color.WHITE)
	name_label.text = "P%d" % color_index

func _physics_process(_delta: float) -> void:
	# Only the owning peer processes input — others just receive synced position
	if not is_multiplayer_authority():
		return

	var direction := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	velocity = direction * SPEED
	move_and_slide()
```

**Step 2: Write `scenes/characters/player.tscn`**

```
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/player.gd" id="1"]

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1")

[node name="ColorRect" type="ColorRect" parent="."]
offset_left = -20.0
offset_top = -20.0
offset_right = 20.0
offset_bottom = 20.0
color = Color(0.392157, 0.584314, 0.929412, 1)

[node name="CollisionShape2D" type="CollisionShape2D" parent="."]

[node name="NameLabel" type="Label" parent="."]
offset_left = -20.0
offset_top = -40.0
offset_right = 20.0
offset_bottom = -20.0
horizontal_alignment = 1

[node name="MultiplayerSynchronizer" type="MultiplayerSynchronizer" parent="."]
```

**Step 3: Configure MultiplayerSynchronizer in editor**

After opening the project in Godot:
1. Open `scenes/characters/player.tscn`
2. Select the `MultiplayerSynchronizer` node
3. In the Inspector, click **Replication** → **Add Property**
4. Add `CharacterBody2D:position` — set it to **Sync** mode

This tells Godot to automatically replicate the `position` property to all peers.

**Step 4: Add CollisionShape in editor**

1. Select `CollisionShape2D` node
2. In Inspector: Shape → New RectangleShape2D → set Size to `Vector2(40, 40)`

**Step 5: Verify locally**

Run the scene (`player.tscn`) in the editor. You should see a blue square. WASD moves it. No networking yet — just confirming the scene works.

---

## Task 4: Main Menu Scene

**Files:**
- Create: `scripts/main_menu.gd`
- Create: `scenes/ui/main_menu.tscn`

A minimal UI: Host button, Join button, IP address input field, and a status label.

**Step 1: Write `scripts/main_menu.gd`**

```gdscript
extends Control

@onready var ip_input: LineEdit = $VBoxContainer/IPInput
@onready var status_label: Label = $VBoxContainer/StatusLabel
@onready var host_button: Button = $VBoxContainer/HostButton
@onready var join_button: Button = $VBoxContainer/JoinButton

func _ready() -> void:
	ip_input.text = "127.0.0.1"
	status_label.text = ""

func _on_host_button_pressed() -> void:
	status_label.text = "Starting host..."
	host_button.disabled = true
	join_button.disabled = true
	get_tree().get_root().get_node("Game").host_game()

func _on_join_button_pressed() -> void:
	var ip := ip_input.text.strip_edges()
	if ip.is_empty():
		status_label.text = "Enter an IP address first."
		return
	status_label.text = "Connecting to %s..." % ip
	host_button.disabled = true
	join_button.disabled = true
	get_tree().get_root().get_node("Game").join_game(ip)

func set_status(text: String) -> void:
	status_label.text = text
```

**Step 2: Write `scenes/ui/main_menu.tscn`**

```
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/main_menu.gd" id="1"]

[node name="MainMenu" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
script = ExtResource("1")

[node name="VBoxContainer" type="VBoxContainer" parent="."]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -150.0
offset_top = -120.0
offset_right = 150.0
offset_bottom = 120.0
theme_override_constants/separation = 16

[node name="Title" type="Label" parent="VBoxContainer"]
text = "DUNGEON DASH"
horizontal_alignment = 1
theme_override_font_sizes/font_size = 32

[node name="HostButton" type="Button" parent="VBoxContainer"]
text = "Host Game"

[node name="IPInput" type="LineEdit" parent="VBoxContainer"]
placeholder_text = "Enter host IP to join..."
text = "127.0.0.1"

[node name="JoinButton" type="Button" parent="VBoxContainer"]
text = "Join Game"

[node name="StatusLabel" type="Label" parent="VBoxContainer"]
horizontal_alignment = 1
autowrap_mode = 2

[connection signal="pressed" from="VBoxContainer/HostButton" to="." method="_on_host_button_pressed"]
[connection signal="pressed" from="VBoxContainer/JoinButton" to="." method="_on_join_button_pressed"]
```

---

## Task 5: Game Root Scene (Networking Hub)

**Files:**
- Create: `scripts/game.gd`
- Create: `scenes/world/game.tscn`

This is the root scene. It owns the multiplayer setup and spawns players.

**Step 1: Write `scripts/game.gd`**

```gdscript
extends Node

const PORT = 7777
const MAX_PEERS = 1  # One guest + host = 2 players total
const PLAYER_SCENE = preload("res://scenes/characters/player.tscn")

@onready var players_node: Node2D = $World/Players
@onready var main_menu: Control = $UI/MainMenu

func _ready() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected_to_server)
	multiplayer.connection_failed.connect(_on_connection_failed)

# ── Hosting ──────────────────────────────────────────────────────────────────

func host_game() -> void:
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_server(PORT, MAX_PEERS)
	if error != OK:
		main_menu.set_status("Failed to create server (error %d)" % error)
		return

	multiplayer.multiplayer_peer = peer
	GameState.connected_players.append(1)  # Host is always peer ID 1
	_spawn_player(1)
	main_menu.set_status("Hosting on port %d — waiting for guest..." % PORT)
	_show_local_ip()

func _show_local_ip() -> void:
	# Display the local IP so the guest knows what to type
	var ips := IP.get_local_addresses()
	for ip in ips:
		# Filter for typical LAN IPv4 addresses
		if ip.begins_with("192.168.") or ip.begins_with("10."):
			main_menu.set_status("Hosting — your IP: %s" % ip)
			return

# ── Joining ───────────────────────────────────────────────────────────────────

func join_game(ip: String) -> void:
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_client(ip, PORT)
	if error != OK:
		main_menu.set_status("Failed to connect (error %d)" % error)
		return
	multiplayer.multiplayer_peer = peer

# ── Multiplayer Callbacks ─────────────────────────────────────────────────────

func _on_peer_connected(id: int) -> void:
	# Called on HOST when a new guest connects
	if not multiplayer.is_server():
		return
	GameState.connected_players.append(id)
	# Spawn the new guest's player on all peers
	_spawn_player.rpc(id)
	# Tell the new guest about the host player too
	_spawn_player.rpc_id(id, 1)
	main_menu.set_status("Guest connected!")

func _on_peer_disconnected(id: int) -> void:
	GameState.connected_players.erase(id)
	# Remove the disconnected player's node
	var player := players_node.get_node_or_null(str(id))
	if player:
		player.queue_free()
	main_menu.set_status("Guest disconnected. Continuing solo.")

func _on_connected_to_server() -> void:
	# Called on CLIENT when connection succeeds
	# Server will call _spawn_player RPC for us — nothing to do here
	main_menu.set_status("Connected!")

func _on_connection_failed() -> void:
	main_menu.set_status("Connection failed. Check the IP and try again.")

# ── Spawning ──────────────────────────────────────────────────────────────────

@rpc("authority", "call_local", "reliable")
func _spawn_player(peer_id: int) -> void:
	# Don't double-spawn
	if players_node.get_node_or_null(str(peer_id)) != null:
		return

	var player := PLAYER_SCENE.instantiate()
	player.name = str(peer_id)
	# Stagger starting positions so players don't overlap
	var offset := Vector2(100.0 + peer_id * 120.0, 360.0)
	player.position = offset
	players_node.add_child(player)
```

**Step 2: Write `scenes/world/game.tscn`**

```
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/game.gd" id="1"]

[node name="Game" type="Node"]
script = ExtResource("1")

[node name="World" type="Node2D" parent="."]

[node name="Background" type="ColorRect" parent="World"]
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
color = Color(0.15, 0.12, 0.1, 1)

[node name="Players" type="Node2D" parent="World"]

[node name="UI" type="CanvasLayer" parent="."]

[node name="MainMenu" type="Control" parent="UI"]
```

**Step 3: Attach MainMenu scene in editor**

The `.tscn` file above creates a blank `Control` node for `MainMenu`. After opening in Godot:
1. Right-click the `MainMenu` node under `UI`
2. Choose **"Change Type"** → no, instead: delete it and then right-click `UI` → **Instantiate Child Scene** → select `scenes/ui/main_menu.tscn`
3. Rename the instantiated node to `MainMenu`

**Step 4: Set Game as main scene**

In Godot editor: Project → Project Settings → Application → Run → Main Scene → set to `res://scenes/world/game.tscn`

**Step 5: Verify single-player locally**

Run the project (F5). You should see the Dungeon Dash title screen with Host/Join buttons. Click **Host Game** — a blue square should appear and you should be able to move it with WASD.

---

## Task 6: Milestone 0 Verification — Two Players Over LAN

**What you need:**
- Two instances of Godot running (or one editor + one exported build)
- Both on the same WiFi network

**Option A: Two editor instances on one machine (quickest test)**

1. Open Godot project normally
2. Go to **Debug → Run Multiple Instances → Run 2 Instances**
3. In Instance 1: click **Host Game** — note the IP shown
4. In Instance 2: enter `127.0.0.1` → click **Join Game**

**Option B: Two machines on same WiFi**

1. Machine A: open project, click **Host Game** — note the IP displayed (e.g. `192.168.1.42`)
2. Machine B: open project, enter that IP → click **Join Game**

**Expected result:**
- Both windows show two colored squares (blue = P1, red = P2)
- Moving WASD on Instance 1 moves the blue square on **both** screens
- Moving WASD on Instance 2 moves the red square on **both** screens
- No noticeable lag between the two instances

**If it works:** Milestone 0 is achieved. The foundation is proven. Proceed to Milestone 1 plan.

**If connection fails:**
- Check Windows Firewall isn't blocking port 7777 (add inbound rule for UDP 7777)
- Confirm both machines are on the same subnet
- Try disabling firewall temporarily to isolate the issue

---

## What's Next (Milestone 1 Plan)

Once Milestone 0 passes, the next plan covers:
- First `combat_room.tscn` with Kenney tileset
- Skeleton enemy with chase AI (host-authoritative)
- Hitbox/hurtbox damage system
- HP bars on HUD
- Player downed state + revive mechanic
