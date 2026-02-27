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
