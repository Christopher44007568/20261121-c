extends Node

# Autoload entry point. When the project is launched with the
# `--analyze` command-line flag it runs the full geometry analysis and quits;
# otherwise the normal demo scene runs.


func _ready() -> void:
	if "--analyze" in OS.get_cmdline_user_args() or "--analyze" in OS.get_cmdline_args():
		var runner: RefCounted = load("res://analysis/geometry_analyzer.gd").new()
		runner.tree = self.get_tree()
		runner.run()
		get_tree().quit(runner.exit_code)
