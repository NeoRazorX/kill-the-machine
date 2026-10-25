"""Render the actual Segador GLB: blender -b --python tools/render_icon.py."""

from pathlib import Path
import math

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'assets/models/m_crusher.glb'))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
points = [obj.matrix_world @ Vector(p) for obj in meshes for p in obj.bound_box]
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
center = (low + high) / 2

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = True
scene.world.color = (0.035, 0.045, 0.065)
scene.view_settings.view_transform = 'AgX'

bpy.ops.object.camera_add(location=center + Vector((5, -8, 5)))
camera = bpy.context.object
camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
# Keep all geometry inside the maskable safe circle, including the long cannon.
inverse = camera.rotation_euler.to_matrix().transposed()
projected = [inverse @ (point - center) for point in points]
offset = Vector(((min(p.x for p in projected) + max(p.x for p in projected)) / 2,
                 (min(p.y for p in projected) + max(p.y for p in projected)) / 2, 0))
camera.location += camera.rotation_euler.to_matrix() @ offset
radius = max(math.hypot(p.x - offset.x, p.y - offset.y) for p in projected)
camera.data.ortho_scale = radius * 2 / .77
scene.camera = camera

for location, energy, color, size in [
    ((-3, -5, 8), 1500, (0.78, 0.87, 1.0), 5),
    ((5, -1, 4), 1100, (1.0, 0.58, 0.4), 4),
    ((0, 5, 6), 1800, (0.35, 0.55, 1.0), 3),
]:
    bpy.ops.object.light_add(type='AREA', location=center + Vector(location))
    light = bpy.context.object
    light.data.energy = energy
    light.data.color = color
    light.data.shape = 'DISK'
    light.data.size = size
    light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()

scene.render.filepath = str(ROOT / 'assets/icons/spider-master.png')
bpy.ops.render.render(write_still=True)
