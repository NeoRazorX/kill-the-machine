"""Rebuild all Blender assets: blender -b --python tools/build_models.py
Coordinates in helpers match the game: +Y up, +Z forward. Blender stores +Z up.
No external textures. Static parts are joined; animated pivots remain independent.
"""
import bpy
import bmesh
import math
import random
from pathlib import Path
from mathutils import Matrix, Vector
import sys

OUT = Path(__file__).resolve().parents[1] / 'assets' / 'models'
OUT.mkdir(parents=True, exist_ok=True)
OLIVE = '#697955'
LIGHT = '#89946c'
DARK = '#272f2d'
STEEL = '#59676b'
BLUE = '#378ffa'
GLASS = '#90d6e9'
YELLOW = '#e4b84c'
MACHINE = '#39434f'
MPLATE = '#596675'
BLACK = '#161d27'
RED = '#ff3e31'
ORANGE = '#ff921f'
TEAL = '#46e6bc'
WHITE = '#d8dcdc'
# Neutral, weathered pre-war palette for the capturable tech structures.
CONCRETE = '#8b8a82'
CONCRETE_D = '#6f6e67'
CONCRETE_L = '#a4a297'
RUST = '#8c5a3b'
RUST_D = '#5b4234'
IRON = '#4e5351'
HAZARD = '#c9a646'
SOOT = '#24221f'
DOOR = '#6c6a62'
CRANE = '#b48f3e'
COPPER = '#b06f3d'
CANVAS = '#a69f87'
PRIMER = '#a39a84'
GUNMETAL = '#555b57'
SHEET = '#868d83'
VEST = '#e98a2b'


def xyz(v):
    return (v[0], -v[2], v[1])


def color(hex_value):
    return tuple(int(hex_value[i:i+2], 16) / 255 for i in (1, 3, 5)) + (1,)


def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.data.orphans_purge(do_recursive=True)
    material = bpy.data.materials.get('Paint') or bpy.data.materials.new('Paint')
    material.use_nodes = True
    material.use_backface_culling = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Metallic'].default_value = .3
    shader.inputs['Roughness'].default_value = .68
    vertex = nodes.new('ShaderNodeVertexColor')
    vertex.layer_name = 'Color'
    material.node_tree.links.new(vertex.outputs['Color'], shader.inputs['Base Color'])
    material.node_tree.links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    return material


def finish(obj, tint, bevel=0):
    bpy.context.view_layer.objects.active = obj
    if bevel:
        mod = obj.modifiers.new('Armor edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.clear()
    if tint in (RED, ORANGE, TEAL):
        name = 'Signal_' + tint[1:]
        mat = bpy.data.materials.get(name)
        if not mat:
            mat = bpy.data.materials.new(name)
            mat.use_nodes = True
            mat.use_backface_culling = True
            shader = mat.node_tree.nodes.get('Principled BSDF')
            shader.inputs['Base Color'].default_value = color(tint)
            shader.inputs['Emission Color'].default_value = color(tint)
            shader.inputs['Emission Strength'].default_value = .65
            shader.inputs['Roughness'].default_value = .4
        obj.data.materials.append(mat)
    else:
        obj.data.materials.append(bpy.data.materials['Paint'])
    attr = obj.data.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    rgba = color(tint)
    for item in attr.data:
        item.color_srgb = rgba
    return obj


def box(name, size, pos, tint, bevel=.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(pos))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, tint, bevel)


def cyl(name, radius, depth, pos, tint, axis='y', vertices=10):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=xyz(pos))
    obj = bpy.context.object
    obj.name = name
    if axis == 'x':
        obj.rotation_euler[1] = math.pi / 2
    elif axis == 'z':
        obj.rotation_euler[0] = math.pi / 2
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return finish(obj, tint, .018)


def armor(name, width, length, bottom, top, inset, center, tint):
    # Chamfered footprint, sloping upper armor: silhouette is authored, not stacked cubes.
    def ring(w, d, y):
        c = min(w, d) * .17
        return [(x + center[0], y, z + center[1]) for x, z in
                [(-w/2+c,-d/2),(w/2-c,-d/2),(w/2,-d/2+c),(w/2,d/2-c),
                 (w/2-c,d/2),(-w/2+c,d/2),(-w/2,d/2-c),(-w/2,-d/2+c)]]
    verts = ring(width, length, bottom) + ring(width-inset, length-inset, top)
    faces = [tuple(reversed(range(8))), tuple(range(8,16))]
    faces += [(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(v) for v in verts], [], [tuple(reversed(f)) for f in faces])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    return finish(obj, tint, .025)


def empty(name, pos, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = xyz(pos)
    if parent:
        obj.parent = parent  # pos is local to parent
    return obj


def merge(name, objects, parent=None):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    # Keep geometry in world coordinates; place origin exactly on its animation pivot.
    bpy.context.view_layer.update()
    bpy.context.scene.cursor.location = parent.matrix_world.translation if parent else (0,0,0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    if parent:
        world = obj.matrix_world.copy()
        obj.parent = parent
        obj.matrix_world = world
    return obj


def save(name):
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / f'{name}.blend'))
    bpy.ops.export_scene.gltf(filepath=str(OUT / f'{name}.glb'), export_format='GLB',
                              export_yup=True, export_animations=False, export_extras=True)


def tank():
    reset()
    hull = []
    for s in (-1,1):
        hull.append(box('Track belt', (.64,.64,3.15), (s*1.12,.4,0), DARK, .16))
        for z in (-1.03,-.34,.34,1.03):
            hull.append(cyl('Road wheel', .26,.06,(s*1.46,.4,z),STEEL,'x'))
        hull.append(armor('Track guard',.72,3.25,.66,.89,.12,(s*1.12,0),OLIVE))
        for z in (-.9,0,.9):
            hull.append(box('Skirt armor',(.09,.3,.78),(s*1.48,.68,z),LIGHT,.03))
    hull.append(armor('Lower chassis',2.12,3.1,.45,.92,.12,(0,0),DARK))
    hull.append(armor('Sloped hull',2.1,3.1,.8,1.23,.65,(0,0),OLIVE))
    hull.append(box('Front identification',(.75,.07,.48),(0,1.22,1.12),BLUE,.01))
    for s in (-1,1):
        hull.append(box('Headlight recess',(.32,.2,.12),(s*.77,.97,1.45),DARK))
        hull.append(box('Headlight',(.22,.09,.04),(s*.77,1,1.52),GLASS,.01))
        hull.append(box('Rear fuel pod',(.45,.32,.6),(s*.72,1.17,-1.13),STEEL,.07))
    for x in (-.35,-.12,.12,.35):
        hull.append(box('Engine grille',(.12,.025,.48),(x,1.24,-1.06),DARK,.005))
    merge('Chassis',hull)
    t = empty('turret',(0,1.22,0))
    b = empty('barrel',(0,.34,.69),t)
    empty('muzzle',(0,0,1.94),b)
    bpy.context.view_layer.update()
    turret = [cyl('Turret race',.67,.13,(0,1.25,0),STEEL),
              armor('Faceted turret',1.74,1.75,1.29,1.91,.62,(0,-.08),LIGHT),
              box('Mantlet',(.66,.39,.36),(0,1.56,.69),OLIVE,.09),
              cyl('Commander hatch',.3,.1,(-.32,1.96,-.18),DARK),
              box('Optic',(.26,.17,.3),(.32,1.99,.12),DARK),
              box('Optic lens',(.2,.08,.02),(.32,2.01,.28),GLASS,.005)]
    for s in (-1,1):
        turret.append(box('Blue unit stripe',(.025,.12,.6),(s*.76,1.5,-.28),BLUE,.005))
    merge('Turret armor',turret,t)
    barrel = [cyl('Gun sleeve',.15,.55,(0,1.56,1.03),OLIVE,'z'),
              cyl('Gun tube',.09,1.18,(0,1.56,1.8),STEEL,'z'),
              box('Muzzle brake',(.28,.23,.34),(0,1.56,2.46),DARK,.035),
              box('Bore',(.13,.10,.012),(0,1.56,2.637),'#080d10',.008)]
    merge('Gun',barrel,b)
    save('h_tank')


def factory():
    reset()
    parts = [box('Foundation',(5.8,.3,5.8),(0,.15,0),STEEL,.08),
             box('Assembly hall',(5.25,2.55,4.55),(0,1.58,-.5),OLIVE,.1),
             box('Roof cap',(5.45,.25,4.7),(0,2.96,-.5),DARK,.08)]
    for x in (-1.65,0,1.65):
        parts.append(armor('Sawtooth roof',1.55,4.5,3.01,3.43,.32,(x,-.5),LIGHT))
        parts.append(box('Roof skylight',(.65,.025,2.3),(x,3.45,-.65),GLASS,.02))
    parts += [box('Door recess',(3.35,2.3,.12),(0,1.45,1.82),DARK),
              box('Roller door',(2.97,1.9,.07),(0,1.49,1.9),STEEL)]
    for y in (.7,1.02,1.34,1.66,1.98,2.3):
        parts.append(box('Door slat',(2.94,.045,.045),(0,y,1.95),DARK,.006))
    for s in (-1,1):
        parts.append(box('Gate pillar',(.28,2.4,.34),(s*1.77,1.5,1.91),LIGHT))
        for y in (.5,1.05,1.6,2.15):
            parts.append(box('Safety mark',(.29,.2,.04),(s*1.77,y,2.1),YELLOW,.008))
        parts.append(box('Team panel',(.42,.65,.06),(s*2.25,2.18,1.82),BLUE))
        parts.append(box('Side buttress',(.22,2.4,.4),(s*2.65,1.48,-1.9),LIGHT))
    parts.append(box('Door lintel',(3.8,.2,.38),(0,2.72,1.92),BLUE))
    parts.append(box('Loading apron',(3.5,.08,.8),(0,.34,2.42),DARK,.02))
    for x in (-1.42,1.42):
        parts.append(box('Apron guide',(.12,.012,.75),(x,.386,2.42),YELLOW,.004))
    for x in (-2.08,-1.3):
        parts.append(cyl('Chimney',.23,1.3,(x,3.61,-2.12),STEEL))
        parts.append(cyl('Chimney collar',.3,.16,(x,4.23,-2.12),DARK))
        parts.append(cyl('Chimney opening',.21,.01,(x,4.315,-2.12),'#111719'))
    parts.append(box('Vent housing',(.24,1.2,1.65),(2.72,1.5,-.05),DARK))
    for z in (-.65,-.3,.05,.4):
        parts.append(box('Vent fin',(.08,.9,.12),(2.86,1.5,z),STEEL,.01))
    merge('Factory',parts)
    save('h_factory')


# Additional geometry helpers, authored in game coordinates.
def cone(name, r1, r2, depth, pos, tint, vertices=10):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=xyz(pos))
    obj = bpy.context.object
    obj.name = name
    return finish(obj, tint)


def gem(name, size, pos, tint):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=xyz(pos))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, tint)


def torus(name, radius, tube, pos, tint, axis='y'):
    bpy.ops.mesh.primitive_torus_add(major_segments=16, minor_segments=4, major_radius=radius, minor_radius=tube, location=xyz(pos))
    obj = bpy.context.object
    obj.name = name
    if axis == 'z':
        obj.rotation_euler[0] = math.pi/2
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return finish(obj, tint)


def beam(name, a, b, width, tint, bevel=None):
    a, b = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cube_add(size=1, location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (width, width, (b-a).length)
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return finish(obj, tint, min(.025, width*.15) if bevel is None else bevel)


def tracked_chassis(machine=False):
    hull, edge, base = (MACHINE, MPLATE, BLACK) if machine else (OLIVE, LIGHT, DARK)
    objects = [armor('Armored chassis',2,3.05,.6,1.05,.25,(0,0),hull)]
    for s in (-1,1):
        objects.append(box('Track',(.62,.65,3.15),(s*1.02,.37,0),base,.12))
        objects.append(armor('Side armor',.68,3.05,.63,.87,.12,(s*1.03,0),edge))
        for z in (-.98,0,.98):
            objects.append(cyl('Wheel',.24,.06,(s*1.35,.38,z),STEEL,'x',8))
    return objects


def infantry(machine=False, heavy=False, medic=False, engineer=False):
    reset()
    id = ('m_sentinel' if machine else 'h_medic' if medic else 'h_engineer' if engineer
          else 'h_rocket' if heavy else 'h_rifle')
    hull, edge, base, accent = (MACHINE,MPLATE,BLACK,RED) if machine else (OLIVE,LIGHT,DARK,BLUE)
    hip = 1.16 if machine else .72
    body_y = 1.65 if machine else 1.1
    head_y = 2.4 if machine else 1.7
    for i,s in enumerate((-1,1)):
        x = s*(.32 if machine else .19)
        pivot = empty(f'leg_{i}',(x,hip,0))
        objects = [box('Boot',(.35 if machine else .25,.16,.45),(x,.1,.1),base,.04),
                   beam('Shin',(x,.2,.01),(x,hip*.56,-.06),.18 if machine else .17,edge),
                   box('Knee',(.27,.23,.27),(x,hip*.54,.02),hull),
                   beam('Thigh',(x,hip*.56,-.02),(x,hip,0),.25 if machine else .2,base)]
        merge('Leg armor',objects,pivot)
    body = empty('body',(0,0,0))
    objects = [armor('Torso',.91 if machine else .66,.57 if machine else .43,body_y-.33,body_y+.34,.14,(0,0),hull),
               box('Chest plate',(.66 if machine else .49,.29,.1),(0,body_y+.08,.28 if machine else .23),VEST if engineer else edge),
               box('Identification',(.55 if machine else .35,.07,.03),(0,body_y+.14,.34 if machine else .295),accent,.005)]
    if engineer:
        # High-visibility vest, tool belt and a heavy tool pack with a cable reel.
        objects += [box('Reflective stripe',(.5,.05,.03),(0,body_y-.02,.285),WHITE,.004),
                    box('Vest side',(.06,.42,.36),(-.335,body_y-.02,0),VEST,.01),
                    box('Vest side',(.06,.42,.36),(.335,body_y-.02,0),VEST,.01),
                    box('Tool belt',(.72,.1,.5),(0,body_y-.3,0),DARK,.02),
                    box('Belt pouch',(.15,.17,.11),(-.2,body_y-.36,.25),STEEL,.02),
                    box('Belt pouch',(.13,.15,.1),(.21,body_y-.35,.25),YELLOW,.02),
                    box('Tool pack',(.58,.6,.32),(0,body_y-.02,-.38),DARK,.05),
                    box('Pack flap',(.6,.1,.34),(0,body_y+.26,-.38),STEEL,.02),
                    box('Pack stripe',(.6,.06,.03),(0,body_y-.1,-.55),VEST,.005),
                    cyl('Cable reel',.2,.44,(0,body_y+.47,-.38),DARK,'x',12),
                    cyl('Cable coil',.15,.36,(0,body_y+.47,-.38),VEST,'x',12),
                    cyl('Pack antenna',.018,.55,(.22,body_y+.55,-.48),STEEL,vertices=6)]
    else:
        objects.append(box('Backpack',(.51,.52,.25),(0,body_y,-.35),WHITE if medic else base,.04))
    if medic:
        # Cruz roja en mochila y pecho; brazalete blanco.
        objects += [box('Cross bar',(.3,.09,.02),(0,body_y,-.48),RED,.005),
                    box('Cross post',(.09,.3,.02),(0,body_y,-.48),RED,.005),
                    box('Chest cross bar',(.16,.05,.02),(0,body_y+.14,.3),RED,.004),
                    box('Chest cross post',(.05,.16,.02),(0,body_y+.14,.3),RED,.004),
                    box('Armband',(.32,.1,.37),(-.38,body_y+.02,0),WHITE,.02)]
    if machine:
        objects += [armor('Sensor head',.65,.5,2.2,2.61,.22,(0,0),base),
                    box('Visor',(.45,.075,.03),(0,2.43,.25),RED,.005)]
    elif engineer:
        objects += [box('Face',(.28,.26,.25),(0,head_y,.035),'#d7a779',.055),
                    armor('Hard hat',.44,.45,head_y+.03,head_y+.2,.16,(0,0),YELLOW),
                    box('Hat brim',(.5,.035,.54),(0,head_y+.045,.03),YELLOW,.01),
                    box('Hat ridge',(.08,.04,.36),(0,head_y+.205,0),YELLOW,.01),
                    box('Head lamp',(.1,.07,.04),(0,head_y+.12,.235),GLASS,.01),
                    box('Visor',(.3,.075,.03),(0,head_y-.02,.17),GLASS,.005)]
    else:
        objects += [box('Face',(.28,.26,.25),(0,head_y,.035),'#d7a779',.055),
                    armor('Helmet',.44,.43,head_y+.01,head_y+.18,.11,(0,0),hull),
                    box('Visor',(.3,.075,.03),(0,head_y+.045,.225),GLASS,.005)]
    shoulder = .6 if machine else .38
    for s in (-1,1):
        objects += [box('Pauldron',(.3,.27,.35),(s*shoulder,body_y+.17,0),hull,.06),
                    beam('Forearm',(s*shoulder,body_y+.02,.05),(s*shoulder,body_y-.1,.35),.16,base)]
    gun_x = shoulder
    gun_y = 1.5 if heavy else 1.94 if machine else 1.18
    if medic:
        # Botiquín en una mano, emisor de vendaje en la otra.
        objects += [box('Medkit',(.34,.26,.16),(-shoulder,1.0,.3),WHITE,.03),
                    box('Medkit cross',(.12,.04,.17),(-shoulder,1.0,.3),RED,.004),
                    box('Spray body',(.14,.14,.4),(gun_x,gun_y,.45),WHITE),
                    cyl('Spray nozzle',.045,.18,(gun_x,gun_y,.73),STEEL,'z',8)]
        muzzle_z = .83
    elif engineer:
        # Unarmed: a heavy wrench in the right hand, a diagnostic tablet in the left.
        objects += [beam('Wrench handle',(gun_x,body_y-.12,.3),(gun_x,body_y+.32,.56),.07,STEEL),
                    box('Wrench jaw',(.09,.1,.24),(gun_x,body_y+.37,.6),STEEL,.015),
                    box('Wrench jaw',(.09,.08,.11),(gun_x,body_y+.45,.66),STEEL,.015),
                    box('Wrench grip',(.1,.16,.1),(gun_x,body_y-.08,.32),YELLOW,.02),
                    tbox('Tablet',(.26,.04,.2),(-shoulder,body_y-.05,.42),DARK,(.7,0,0),.012),
                    tbox('Tablet screen',(.2,.012,.14),(-shoulder,body_y-.03,.43),GLASS,(.7,0,0),.004)]
        gun_y, muzzle_z = body_y+.42, .7
    elif heavy:
        objects += [cyl('Rocket launcher',.14,1.27,(gun_x,gun_y,.32),base,'z',8),
                    cyl('Rocket tube lip',.18,.12,(gun_x,gun_y,.93),edge,'z',8),
                    cyl('Launcher bore',.115,.012,(gun_x,gun_y,.995),BLACK,'z',8),
                    box('Ammo pack',(.42,.6,.22),(-.08,1.1,-.47),YELLOW)]
        muzzle_z = 1.01
    else:
        objects += [box('Weapon housing',(.22,.22,.68),(gun_x,gun_y,.42),base),
                    cyl('Barrel',.055 if not machine else .085,.4,(gun_x,gun_y,.93),STEEL,'z',8)]
        if machine:
            objects.append(torus('Emitter',.12,.035,(gun_x,gun_y,1.12),RED,'z'))
        muzzle_z = 1.15
    empty('muzzle',(gun_x,gun_y,muzzle_z),body)
    merge('Body armor',objects,body)
    save(id)


def repair_truck():
    reset()
    objects = [box('Chassis',(2,.37,3.3),(0,.68,0),DARK,.07)]
    for s in (-1,1):
        for z in (-1.1,1.1):
            objects += [cyl('Tire',.46,.38,(s*.99,.46,z),DARK,'x'),
                        cyl('Hub',.23,.025,(s*1.19,.46,z),STEEL,'x')]
    objects += [armor('Cab',1.72,1.15,.83,1.86,.35,(0,1.05),OLIVE),
                box('Windscreen',(1.3,.32,.07),(0,1.53,1.56),GLASS),
                box('Bumper',(1.8,.2,.2),(0,.76,1.78),DARK),
                box('Beacon',(.5,.12,.18),(0,1.92,1.05),YELLOW,.02),
                box('Tool bed',(1.86,.5,1.8),(0,1.1,-.65),LIGHT),
                box('Tool locker',(1.9,.3,.5),(0,1.48,-1.25),OLIVE),
                box('Hazard stripe',(1.92,.06,.12),(0,1.63,-1.5),YELLOW,.008),
                cyl('Crane base',.3,.3,(0,1.5,-.3),STEEL),
                beam('Crane boom',(0,1.65,-.3),(0,2.25,.55),.2,YELLOW),
                beam('Crane jib',(0,2.25,.55),(0,1.95,1.05),.14,YELLOW),
                cyl('Welder head',.12,.22,(0,1.9,1.12),DARK,'z',8),
                box('Unit stripe',(.06,.18,.9),(1,1.1,-.65),BLUE,.008),
                box('Unit stripe',(.06,.18,.9),(-1,1.1,-.65),BLUE,.008)]
    merge('Repair truck',objects)
    empty('muzzle',(0,1.88,1.25))
    save('h_mech')


def welder():
    reset()
    objects = tracked_chassis(True)
    objects += [armor('Workshop',1.6,2.2,1.05,1.7,.35,(0,-.35),MPLATE),
                box('Sensor bar',(.9,.1,.06),(0,1.55,.78),TEAL,.008),
                cyl('Coolant tank',.22,1.2,(.55,1.9,-.6),BLACK,'z',8),
                cyl('Coolant tank',.22,1.2,(-.55,1.9,-.6),BLACK,'z',8)]
    for s in (-1,1):
        objects += [cyl('Shoulder joint',.18,.2,(s*.55,1.55,.55),STEEL,'x',8),
                    beam('Upper arm',(s*.55,1.6,.55),(s*.45,2.15,1.05),.14,MACHINE),
                    beam('Forearm',(s*.45,2.15,1.05),(s*.2,1.7,1.55),.11,MPLATE),
                    cone('Torch',.08,.02,.25,(s*.17,1.62,1.68),ORANGE,6)]
    merge('Welder',objects)
    empty('muzzle',(0,1.6,1.75))
    save('m_welder')


def nanite():
    reset()
    bob = empty('bob',(0,1.12,0))
    objects = [gem('Nanite core',(.36,.36,.36),(0,1.12,0),TEAL),
               gem('Shell',(.3,.18,.4),(0,1.32,-.05),MACHINE)]
    for a in range(3):
        ang = a * math.tau / 3
        objects.append(armor('Petal',.28,.42,1.0,1.1,.1,(math.sin(ang)*.45,math.cos(ang)*.45),MPLATE))
    merge('Nanite swarm hub',objects,bob)
    ring = empty('ring',(0,-.22,0),bob)
    objects = [torus('Nanite ring',.42,.04,(0,.9,0),TEAL)]
    for a in (0,math.pi):
        objects.append(box('Ring tab',(.09,.08,.14),(math.sin(a)*.42,.9,math.cos(a)*.42),MPLATE))
    merge('Lift assembly',objects,ring)
    empty('muzzle',(0,0,.4),bob)
    save('m_nanite')


def artillery():
    reset()
    objects = tracked_chassis()
    objects += [box('Engine', (1.7,.33,.68),(0,1.12,-1.09),DARK),
                box('Unit stripe',(1.45,.055,.19),(0,1.3,-1.09),BLUE,.008)]
    merge('Chassis',objects)
    turret = empty('turret',(0,1.05,-.25))
    barrel = empty('barrel',(0,.36,.4),turret)
    objects = [armor('Open gun carriage',1.65,1.55,1.12,1.65,.2,(0,-.27),OLIVE)]
    for s in (-1,1):
        objects.append(cyl('Trunnion',.26,.15,(s*.73,1.42,.1),STEEL,'x'))
    merge('Gun carriage',objects,turret)
    objects = [cyl('Breech',.22,.62,(0,1.41,.37),DARK,'z'),
               cyl('Long barrel',.11,1.8,(0,1.41,1.49),STEEL,'z'),
               box('Muzzle brake',(.32,.25,.32),(0,1.41,2.45),DARK,.04),
               box('Bore',(.16,.11,.012),(0,1.41,2.617),BLACK,.005)]
    merge('Gun',objects,barrel)
    empty('muzzle',(0,0,2.47),barrel)
    # Game Y-up tilt: native X rotation has the same sign.
    barrel.rotation_euler.x = -.24
    save('h_arty')


def harvester(machine=False):
    reset()
    hull, edge, base, accent = (MACHINE,MPLATE,BLACK,RED) if machine else (OLIVE,LIGHT,DARK,BLUE)
    objects = tracked_chassis(True) if machine else [box('Chassis',(2,.37,3.4),(0,.68,0),DARK,.07)]
    if not machine:
        for s in (-1,1):
            for z in (-1.15,0,1.15):
                objects += [cyl('Tire',.46,.38,(s*.99,.46,z),DARK,'x'),
                            cyl('Hub',.23,.025,(s*1.19,.46,z),STEEL,'x')]
    objects += [armor('Cab',1.72,1.2,.83,1.86,.35,(0,1.04),hull),
                box('Windscreen',(1.3,.32,.07),(0,1.53,1.57),GLASS if not machine else RED),
                box('Bumper',(1.8,.2,.2),(0,.76,1.83),base)]
    # Open cargo bin: the runtime hides the mineral mesh when the load is empty.
    for s in (-1,1):
        objects.append(box('Cargo side',(.17,.67,1.93),(s*.88,1.23,-.62),edge))
    objects += [box('Cargo floor',(1.72,.12,1.93),(0,.93,-.62),base),
                box('Tailgate',(1.87,.55,.15),(0,1.24,-1.59),hull),
                box('Bin rim',(1.89,.08,.18),(0,1.56,-1.59),accent)]
    merge('Hauler',objects)
    fill = empty('fill',(0,1.27,-.62))
    fill['height'] = .55
    merge('Mineral load',[box('Ore', (1.48,.55,1.57),(0,1.27,-.62),TEAL,.04)],fill)
    if machine:
        drill = empty('drill',(0,.77,1.68))
        obj = cone('Drill bit',.43,.04,.95,(0,.77,2.04),STEEL,8)
        obj.rotation_euler.x = math.pi/2
        objects = [obj]
        for z,r in ((1.72,.38),(1.98,.27),(2.22,.16)):
            objects.append(torus('Cutting edge',r,.055,(0,.77,z),ORANGE,'z'))
        merge('Borer',objects,drill)
    save('m_harv' if machine else 'h_harv')


def drone():
    reset()
    bob = empty('bob',(0,1.12,0))
    objects = [gem('Sensor pod',(.41,.3,.45),(0,1.12,0),MACHINE),
               gem('Eye',(.16,.11,.08),(0,1.19,.43),RED)]
    for s in (-1,1):
        objects += [armor('Wing',.43,.66,1.03,1.17,.13,(s*.46,-.07),MPLATE),
                    cyl('Thruster',.16,.16,(s*.45,.95,-.09),BLACK,vertices=8)]
    merge('Drone shell',objects,bob)
    ring = empty('ring',(0,-.26,0),bob)
    objects = [torus('Lift ring',.36,.035,(0,.86,0),RED)]
    for a in (0,math.pi):
        objects.append(box('Ring tab',(.09,.08,.14),(math.sin(a)*.36,.86,math.cos(a)*.36),MPLATE))
    merge('Lift assembly',objects,ring)
    empty('muzzle',(0,.07,.54),bob)
    save('m_drone')


def spider(siege=False):
    reset()
    n = 6 if siege else 4
    for i in range(n):
        angle = i*math.tau/n + math.pi/n
        pivot = empty(f'spider_{i}',(0,1.0,0))
        objects = [beam('Femur',(0,1,0),(.0,1.32,.94),.23,MPLATE),
                   gem('Knee',(.22,.22,.22),(0,1.32,.94),MACHINE),
                   beam('Lower leg',(0,1.32,.94),(0,.14,1.47),.15,STEEL),
                   box('Foot',(.25,.16,.36),(0,.08,1.47),BLACK,.04)]
        merge('Leg',objects,pivot)
        pivot.rotation_euler.z = angle
    merge('Carapace',[armor('Hull',2.13,2.1,1.08,1.53,.38,(0,0),MACHINE),
                       cyl('Turret bearing',.66,.15,(0,1.6,0),BLACK,vertices=8)])
    turret = empty('turret',(0,1.65,-.1 if siege else 0))
    barrel = empty('barrel',(0,.25,.45),turret)
    merge('Weapon housing',[armor('Turret shell',1.3,1.15,1.69,2.13,.33,(0,-.1),MPLATE),
                           box('Target sensor',(.42,.1,.06),(0,2.08,.39),RED,.008)],turret)
    bz = .35 if siege else .45
    length = 1.55 if siege else 1.75
    objects = [cyl('Accelerator',.18 if siege else .14,length,(0,1.9,bz+length/2),STEEL,'z')]
    for z in (bz+.3,bz+.75,bz+1.2):
        objects.append(torus('Plasma coil',.24 if siege else .2,.065,(0,1.9,z),RED,'z'))
    objects += [box('Emitter',(.43,.35,.25),(0,1.9,bz+length),BLACK,.05),
                cyl('Plasma bore',.12,.015,(0,1.9,bz+length+.133),ORANGE if siege else RED,'z')]
    merge('Plasma cannon',objects,barrel)
    empty('muzzle',(0,0,length+.14),barrel)
    if siege:
        barrel.rotation_euler.x = -.36
    save('m_siege' if siege else 'm_crusher')


def platform(w=5.8,d=5.8,machine=False):
    return [box('Foundation',(w,.28,d),(0,.14,0),BLACK if machine else STEEL,.065)]


def turret_building(machine=False):
    reset()
    hull, edge, accent = (MACHINE,MPLATE,RED) if machine else (OLIVE,LIGHT,BLUE)
    objects = platform(3.7,3.7,machine)
    objects += [cone('Pedestal',1.35,.95,.72,(0,.64,0),hull,8),
                cyl('Turret race',.8,.15,(0,1.08,0),STEEL)]
    for s in (-1,1):
        objects.append(box('Foot armor',(.65,.28,2.6),(s*1.37,.38,0),edge,.06))
    merge('Base',objects)
    turret = empty('turret',(0,1.16,0))
    barrel = empty('barrel',(0,.4,.55),turret)
    objects = [armor('Turret armor',1.65,1.7,1.16,1.91,.36,(0,0),hull),
               box('Identification',(.72,.1,.065),(0,1.87,-.72),accent),
               gem('Sensor',(.28,.19,.28),(0,2.03,-.25),RED if machine else GLASS)]
    merge('Head',objects,turret)
    objects = []
    for x in ((0,) if machine else (-.27,.27)):
        objects += [cyl('Gun tube',.12 if machine else .085,1.25,(x,1.56,1.14),STEEL,'z'),
                    cyl('Muzzle collar',.17 if machine else .13,.16,(x,1.56,1.75),RED if machine else DARK,'z')]
    merge('Guns',objects,barrel)
    empty('muzzle',(0 if machine else -.27,0,1.29),barrel)
    save('m_turret' if machine else 'h_turret')


def human_hq():
    reset()
    objects = platform()
    objects += [armor('Armored command foundation',5.35,4.95,.29,1.7,.46,(0,-.12),OLIVE),
                armor('Raised operations block',3.35,3.4,1.6,3.4,.25,(0,-.55),LIGHT),
                armor('Command bridge glazing',3.18,3.14,3.38,3.97,.08,(0,-.55),GLASS),
                armor('Overhanging armored visor',3.62,3.58,3.98,4.19,.14,(0,-.55),DARK),
                box('Bridge identification',(2.45,.13,.07),(0,3.22,1.07),BLUE,.01),
                box('Entrance recess',(1.65,1.47,.1),(0,1.03,2.24),DARK),
                box('Left blast door',(.67,1.2,.06),(-.35,.94,2.31),STEEL,.01),
                box('Right blast door',(.67,1.2,.06),(.35,.94,2.31),STEEL,.01),
                box('Door seam',(.045,1.2,.025),(0,.94,2.35),DARK,0),
                box('Entry lintel',(2.02,.21,.3),(0,1.83,2.25),BLUE),
                armor('Entrance canopy',2.3,1.0,1.98,2.15,.12,(0,2.27),DARK),
                box('Upper entrance step',(1.96,.13,.43),(0,.34,2.46),STEEL),
                box('Lower entrance step',(2.13,.1,.3),(0,.29,2.73),LIGHT),
                box('Threshold guide',(1.7,.012,.055),(0,.412,2.58),YELLOW,0)]
    for s in (-1,1):
        x = s*1.98
        objects += [armor('Armored service wing',1.4,3.4,.3,2.3,.2,(x,.25),OLIVE),
                    armor('Wing roof plate',1.42,3.44,2.31,2.46,.12,(x,.25),DARK),
                    armor('Communications mounting block',1.12,1.06,1.6,2.5,.12,(x,-1.68),LIGHT),
                    box('Wing observation slit',(.83,.25,.05),(x,1.72,1.93),GLASS,.01),
                    box('Window brow',(1.02,.12,.23),(x,1.94,1.96),LIGHT),
                    armor('Entry buttress',.36,.78,.3,1.9,.09,(s*1.12,2.09),LIGHT),
                    box('Buttress signal',(.12,.48,.04),(s*1.12,1.43,2.49),BLUE,.01),
                    box('Roof equipment plinth',(.87,.08,1.08),(x,2.5,.25),STEEL,.015),
                    cyl('Roof fan well',.34,.045,(x,2.56,.25),DARK,vertices=12),
                    torus('Fan rim',.34,.025,(x,2.6,.25),STEEL),
                    cyl('Fan hub',.08,.055,(x,2.61,.25),LIGHT,vertices=8)]
        objects.append(armor('Upper roof armor panel',.7,2.65,4.2,4.27,.08,(s*1.14,-.55),OLIVE))
        for dx in (-.17,0,.17):
            objects.append(box('Fan grille',(.025,.025,.57),(x+dx,2.63,.25),STEEL,0))
        for z in (-.75,.25,1.25):
            objects += [box('Wing armor joint',(.04,1.3,.065),(s*2.61,1.07,z),DARK,0),
                        box('Roof panel seam',(1.09,.02,.025),(x,2.47,z),STEEL,0)]
        for z in (-1.62,-.65,.32):
            objects.append(box('Bridge window mullion',(.07,.59,.08),(s*1.57,3.67,z),DARK,.005))
    for x in (-1.12,-.38,.38,1.12):
        objects.append(box('Front window mullion',(.065,.59,.08),(x,3.67,1.005),DARK,.005))
    objects += [armor('Bridge roof hatch',1.42,1.2,4.2,4.32,.1,(0,-.5),OLIVE),
                box('Command plaque',(1.15,.55,.07),(0,2.78,1.08),DARK,.025),
                box('Rear equipment rack',(1.9,1.03,.45),(0,.83,-2.49),STEEL),
                cyl('Communications mast',.065,2.9,(-2.1,3.87,-1.82),STEEL,vertices=8),
                cyl('Mast foot',.24,.32,(-2.1,2.58,-1.82),DARK),
                box('Radio panel',(.31,.69,.16),(-2.1,4.56,-1.82),LIGHT),
                box('Radio identification',(.32,.1,.17),(-2.1,4.57,-1.82),BLUE,.005),
                beam('Antenna crossbar',(-2.52,5.12,-1.82),(-1.68,5.12,-1.82),.045,STEEL),
                box('Mast beacon',(.12,.1,.12),(-2.1,5.36,-1.82),GLASS,.015)]
    for z in (-.8,-.42):
        objects += [beam('Command chevron',(-.4,4.345,z-.12),(0,4.345,z+.12),.095,BLUE),
                    beam('Command chevron',(0,4.345,z+.12),(.4,4.345,z-.12),.095,BLUE)]
    for x in (-.27,0,.27):
        objects.append(box('Command rank',(.12,.3,.025),(x,2.78,1.13),BLUE,.005))
    for x in (-.73,-.36,0,.36,.73):
        objects.append(box('Rear rack louvre',(.16,.68,.035),(x,.88,-2.73),DARK,.005))
    merge('Headquarters',objects)
    # The entire tilted radar assembly rotates around the existing runtime pivot.
    dish = empty('dish',(1.86,2.5,-1.68))
    objects = [cyl('Radar pedestal',.31,.22,(1.86,2.61,-1.68),STEEL),
               cyl('Radar spindle',.13,1.6,(1.86,3.5,-1.68),DARK),
               beam('Radar fork',(1.53,3.9,-1.68),(1.53,4.6,-1.68),.1,STEEL),
               beam('Radar fork',(2.19,3.9,-1.68),(2.19,4.6,-1.68),.1,STEEL)]
    center = Vector((1.86,4.65,-1.68))
    normal = Vector((0,math.cos(math.pi/6),math.sin(math.pi/6)))
    radial = Vector((0,-normal.z,normal.y))
    segments = 16
    rings = [(.4,-.08),(.78,.19)]
    verts = [tuple(center-normal*.16)]
    verts += [tuple(center + Vector((math.cos(i*math.tau/segments)*r,0,0)) +
                   radial*(math.sin(i*math.tau/segments)*r) + normal*y)
             for r,y in rings for i in range(segments)]
    verts += [tuple(Vector(v)-normal*.07) for v in verts]
    faces = []
    layer = 1+len(rings)*segments
    for i in range(segments):
        n=(i+1)%segments
        front = [(0,1+n,1+i),
                 (1+i,1+n,1+segments+n,1+segments+i)]
        for face in front:
            faces += [face,tuple(v+layer for v in reversed(face))]
        a=1+segments+i;b=1+segments+n
        faces.append((a,a+layer,b+layer,b))
    mesh=bpy.data.meshes.new('Parabolic radar bowl')
    mesh.from_pydata([xyz(v) for v in verts],[],faces);mesh.update()
    obj=bpy.data.objects.new('Parabolic radar bowl',mesh);bpy.context.collection.objects.link(obj)
    objects.append(finish(obj,'#b7c7c7'))
    receiver = center + normal*.85
    for i in (0,5,11):
        a=i*math.tau/segments
        rim=center+Vector((math.cos(a)*.78,0,0))+radial*(math.sin(a)*.78)+normal*.19
        objects.append(beam('Receiver brace',rim,receiver,.035,DARK))
    objects += [beam('Receiver stalk',center-normal*.16,receiver,.05,STEEL),
                box('Receiver head',(.17,.16,.17),receiver,BLUE,.02)]
    merge('Radar',objects,dish)
    save('h_hq')


def cooling_tower(x, z):
    # A hollow, curved shell: wide intake, narrow throat, flared exhaust.
    profile = [(.52,1.08),(1.05,1.01),(1.7,.86),(2.5,.72),
               (3.15,.71),(3.85,.81),(4.62,1.0),
               (4.62,.87),(4.15,.76),(3.85,.68)]
    segments = 20
    verts = [(x + math.cos(i*math.tau/segments)*r, y,
              z + math.sin(i*math.tau/segments)*r)
             for y,r in profile for i in range(segments)]
    faces = []
    for j in range(len(profile)-1):
        for i in range(segments):
            n = (i+1)%segments
            faces.append((j*segments+i,(j+1)*segments+i,(j+1)*segments+n,j*segments+n))
    mesh = bpy.data.meshes.new('Cooling shell')
    mesh.from_pydata([xyz(v) for v in verts],[],faces)
    mesh.update()
    obj = bpy.data.objects.new('Curved concrete cooling tower',mesh)
    bpy.context.collection.objects.link(obj)
    objects = [finish(obj,'#969d88'),
               cyl('Intake shadow',.97,.56,(x,.59,z),DARK,vertices=20),
               cyl('Exhaust depth',.68,.025,(x,3.85,z),DARK,vertices=20),
               torus('Exhaust rim',.94,.065,(x,4.62,z),LIGHT),
               torus('Identification band',.985,.045,(x,4.48,z),BLUE),
               cyl('Tower footing',1.15,.14,(x,.35,z),STEEL,vertices=20)]
    for i in range(12):
        a = i*math.tau/12
        objects.append(beam('Intake support',
            (x+math.cos(a)*1.05,.4,z+math.sin(a)*1.05),
            (x+math.cos(a)*1.03,.95,z+math.sin(a)*1.03),.095,STEEL))
    # Light panel joints make the shell legible at gameplay scale.
    for y,r in ((1.05,1.01),(1.7,.86),(2.5,.72),(3.15,.71),(3.85,.81)):
        objects.append(torus('Concrete seam',r,.018,(x,y,z),'#737c6c'))
    return objects


def human_power_geometry():
    objects = []
    for x in (-1.35,1.35):
        objects += cooling_tower(x,-.82)
        objects += [cyl('Water riser',.15,1.3,(x,.99,.48),STEEL),
                    torus('Pipe flange',.19,.045,(x,1.54,.48),LIGHT),
                    cyl('Turbine feed',.15,.75,(x,1.6,.84),STEEL,'z')]
    objects += [armor('Turbine hall',3.12,1.72,.29,1.82,.2,(.1,1.64),OLIVE),
                box('Service roof',(3.28,.16,1.82),(.1,1.9,1.64),DARK,.045),
                box('Control cabin',(1.0,1.8,1.75),(-2.08,1.19,1.64),LIGHT,.06),
                box('Cabin roof',(1.12,.15,1.89),(-2.08,2.16,1.64),DARK),
                box('Control glazing',(.76,.36,.045),(-2.08,1.7,2.53),GLASS,.012),
                box('Service door',(.47,.92,.05),(-2.08,.82,2.54),DARK),
                box('Door header',(.65,.1,.08),(-2.08,1.32,2.56),BLUE),
                box('Door step',(.9,.1,.28),(-2.08,.34,2.65),STEEL),
                box('Switchgear',(.67,1.16,1.35),(2.25,.88,1.72),LIGHT,.05)]
    for z in (1.28,1.68,2.08):
        objects += [box('Electrical cabinet seam',(.025,.9,.28),(2.596,.95,z),DARK,.005),
                    cyl('Insulator base',.12,.12,(2.25,1.52,z),STEEL,vertices=8),
                    cyl('Ceramic insulator',.075,.3,(2.25,1.71,z),GLASS,vertices=8),
                    torus('Insulator skirt',.11,.035,(2.25,1.72,z),LIGHT)]
    for x in (-.68,.88):
        objects += [box('Fan mount',(1.15,.13,1.24),(x,2.03,1.64),STEEL),
                    cyl('Fan recess',.48,.07,(x,2.13,1.64),DARK,vertices=16),
                    torus('Fan guard',.48,.035,(x,2.18,1.64),LIGHT),
                    cyl('Fan hub',.11,.08,(x,2.19,1.64),STEEL)]
        for angle in (0,math.pi/3,2*math.pi/3):
            objects.append(beam('Fan grille',
                (x-math.cos(angle)*.44,2.2,1.64-math.sin(angle)*.44),
                (x+math.cos(angle)*.44,2.2,1.64+math.sin(angle)*.44),.035,STEEL))
    for x in (-1.05,-.65,-.25,.15,.55,.95,1.35):
        objects.append(box('Turbine louvre',(.22,.52,.065),(x,1.13,2.51),DARK,.012))
    objects += [box('Blue fascia',(2.95,.14,.07),(.1,1.67,2.51),BLUE),
                cyl('Return manifold',.17,4.5,(0,.67,-2.28),STEEL,'x'),
                box('Pump skid',(1.25,.14,.65),(0,.37,-2.25),DARK)]
    for x in (-1.35,1.35):
        objects += [cyl('Return elbow',.17,.65,(x,.67,-1.95),STEEL,'z'),
                    cyl('Manifold flange',.23,.1,(x,.67,-2.28),LIGHT,'x'),
                    torus('Valve wheel',.24,.035,(x,.94,-2.28),BLUE)]
    for x in (-2.66,2.66):
        for z in (-2.56,2.56):
            objects.append(box('Foundation safety marker',(.18,.025,.45),(x,.293,z),YELLOW,.005))
    return objects


def power(machine=False):
    reset()
    objects = platform(3.75,3.75,True) if machine else platform()
    if machine:
        objects += [cone('Reactor plinth',1.53,1.2,.62,(0,.6,0),MACHINE,8),
                    cyl('Core',.59,2.3,(0,1.93,0),RED,vertices=8),
                    cone('Containment cap',1,.72,.4,(0,3.33,0),MPLATE,8)]
        for x,z in ((-1,0),(1,0),(0,-1),(0,1)):
            objects.append(beam('Containment strut',(x*1.27,.7,z*1.27),(x*.75,3.4,z*.75),.22,BLACK))
        merge('Reactor frame',objects)
        for i,y in enumerate((1.25,2.05,2.82)):
            ring = empty(f'ring_{i}',(0,y,0))
            objects = [torus('Containment ring',1.03,.075,(0,y,0),MPLATE)]
            for a in (0,math.pi):
                objects.append(box('Field emitter',(.25,.16,.22),(math.sin(a),y,math.cos(a)),RED))
            merge('Field ring',objects,ring)
    else:
        objects += human_power_geometry()
        merge('Power plant',objects)
    save('m_power' if machine else 'h_power')


def human_refinery():
    reset()
    objects = platform(7.8,5.8)
    objects += [armor('Ore processing hall',4.4,2.9,.29,2.64,.3,(-1.1,-1.05),OLIVE),
                armor('Processing roof',4.5,3.0,2.64,2.84,.15,(-1.1,-1.05),DARK),
                box('Receiving platform',(5.05,.16,2.65),(-.6,.37,1.48),STEEL),
                box('Unloading lane',(3.65,.025,2.12),(-.6,.463,1.48),DARK,.01),
                box('Ore intake recess',(3.2,1.7,.1),(-.6,1.2,.43),DARK),
                box('Intake conveyor',(2.62,.35,.26),(-.6,.7,.53),STEEL),
                box('Intake lintel',(4.95,.22,.38),(-.6,2.31,.72),BLUE),
                cyl('Storage silo',.91,2.9,(2.65,1.79,-1.3),STEEL,vertices=16),
                cone('Silo cap',.94,.12,.61,(2.65,3.55,-1.3),LIGHT,16),
                torus('Silo band',.93,.045,(2.65,2.8,-1.3),BLUE),
                cyl('Settling tank',.65,1.8,(2.8,1.23,1.0),LIGHT,vertices=12),
                torus('Tank collar',.66,.045,(2.8,1.95,1.0),STEEL),
                cyl('Transfer pipe',.14,1.8,(1.75,1.9,-1.3),STEEL,'x'),
                cyl('Tank riser',.11,1.15,(2.8,1.6,.25),STEEL),
                box('Roof extraction unit',(1.65,.37,1.32),(-1.4,3.02,-1.05),LIGHT)]
    for x in (-2.95,1.75):
        objects += [box('Loading gantry pillar',(.23,1.92,.34),(x,1.38,.72),LIGHT),
                    box('Platform guide rail',(.11,.16,1.7),(x,.59,1.87),LIGHT),
                    box('Lane guide',(.1,.015,1.65),(x+(.27 if x<0 else -.27),.484,1.85),YELLOW,0)]
        for y in (.65,1.05,1.45,1.85):
            objects.append(box('Gantry safety marking',(.24,.15,.03),(x,y,.9),YELLOW,.005))
    for x in (-1.65,-1.3,-.95,-.6,-.25,.1,.45):
        objects += [box('Intake grille',(.13,.62,.045),(x,1.3,.5),STEEL,.01),
                    box('Apron hazard stripe',(.19,.02,.26),(x,.472,2.62),YELLOW,.005)]
    for x in (-1.95,-1.55,-1.15,-.75):
        objects.append(box('Extraction louvre',(.18,.025,.96),(x,3.22,-1.05),DARK,.005))
    for x in (-2.85,-2.12):
        objects += [cyl('Exhaust stack',.21,1.05,(x,3.34,-2.06),STEEL,vertices=10),
                    torus('Exhaust rim',.23,.045,(x,3.87,-2.06),DARK)]
    for z in (-1.8,-1.1,-.4):
        objects += [box('Hall wall brace',(.14,1.95,.16),(-3.28,1.31,z),LIGHT),
                    box('Roof panel seam',(3.8,.025,.03),(-1.1,2.85,z),STEEL,0)]
    objects += [box('Control window',(.8,.36,.035),(-2.6,1.92,.41),GLASS,.01),
                box('Control window hood',(.96,.1,.2),(-2.6,2.17,.45),LIGHT),
                box('Pump footing',(.92,.16,.66),(2.8,.37,2.2),DARK),
                cyl('Pump motor',.22,.6,(2.8,.67,2.2),STEEL,'x')]
    # Flush approach ramp stays inside the extra construction footprint.
    verts = [(x,y,z) for x in (-3.125,1.925)
             for y,z in ((.28,2.52),(.45,2.52),(.28,2.98))]
    mesh=bpy.data.meshes.new('Unloading ramp')
    mesh.from_pydata([xyz(v) for v in verts],[],
                    [(0,2,1),(3,4,5),(1,2,5,4),(0,1,4,3),(0,3,5,2)])
    mesh.update()
    ramp=bpy.data.objects.new('Unloading ramp',mesh);bpy.context.collection.objects.link(ramp)
    objects.append(finish(ramp,STEEL))
    merge('Refinery',objects)
    save('h_refinery')


def refinery(machine=False):
    if not machine:
        return human_refinery()
    reset()
    hull, edge, base, accent = MACHINE,MPLATE,BLACK,RED
    objects = platform(machine=True)
    objects += [armor('Processing hall',3.2,3.35,.3,2.57,.3,(-1.05,-.73),hull),
                box('Roof vent',(1.8,.24,1.5),(-1.05,2.64,-.73),base,.05),
                box('Dock',(3.9,.13,1.65),(0,.37,1.94),base),
                box('Intake',(2.1,1.42,.1),(-.65,1.15,1.03),ORANGE)]
    for i in range(6):
        objects.append(box('Loading stripe',(.29,.025,1.58),(-1.6+i*.64,.45,1.94),accent,.005))
    objects += [cone('Smelter hopper',.43,1.03,1.28,(1.79,2.31,-1.09),MPLATE,8),
                    cyl('Furnace neck',.43,1.3,(1.79,1.02,-1.09),BLACK),
                    torus('Furnace rim',1.06,.08,(1.79,2.97,-1.09),ORANGE),
                    cyl('Slag tank',.63,1.6,(1.88,1.18,.72),BLACK),
                    torus('Slag band',.65,.055,(1.88,1.78,.72),RED)]
    for x in (-2.13,-1.35):
        objects += [cyl('Exhaust',.21,1.28,(x,3.29,-1.91),base,vertices=8),
                    torus('Exhaust lip',.23,.05,(x,3.92,-1.91),ORANGE)]
    objects.append(beam('Transfer pipe',(.22,1.85,-.56),(1.68,1.85,-.56),.21,STEEL))
    merge('Refinery',objects)
    save('m_refinery')


def barracks(machine=False):
    reset()
    hull, edge, base, accent = (MACHINE,MPLATE,BLACK,RED) if machine else (OLIVE,LIGHT,DARK,BLUE)
    objects = platform(5.8,3.8,machine)
    objects += [armor('Hall',5.15,2.97,.3,1.99,.27,(0,-.12),hull),
                armor('Roof',5.2,3.1,1.94,2.56,.7,(0,-.12),edge),
                box('Door',(1.17,1.38,.075),(0,1.05,1.42),base),
                box('Door light',(1.42,.12,.1),(0,1.8,1.46),accent)]
    for s in (-1,1):
        objects += [box('Window',(.82,.32,.04),(s*1.61,1.34,1.39),accent if machine else GLASS),
                    box('Roof seam',(.09,.045,2.5),(s*1.73,2.57,-.12),base)]
    if machine:
        for s in (-1,1):
            objects += [beam('Assembly arm',(s*2.32,1.75,-.48),(s*2.32,2.95,-.48),.2,BLACK),
                        beam('Manipulator',(s*2.32,2.95,-.48),(s*1.52,2.95,.55),.17,MPLATE),
                        gem('Tool',(.15,.13,.18),(s*1.52,2.92,.55),RED)]
    else:
        objects += [cyl('Flagpole',.035,2.65,(-2.51,1.62,1.44),STEEL,vertices=6),
                    box('Flag',(.62,.4,.025),(-2.2,2.7,1.44),BLUE,.003)]
        for x in (1.34,2.01):
            objects.append(box('Supply crate',(.54,.43,.45),(x,.51,1.49),DARK))
    merge('Barracks',objects)
    save('m_barracks' if machine else 'h_barracks')


def machine_hq():
    reset()
    objects = platform(machine=True)
    objects += [armor('Core bunker',5.2,5.2,.28,2.15,1.5,(0,0),MACHINE),
                armor('Upper pyramid',3.5,3.5,2.15,3.48,2.1,(0,0),MPLATE),
                cyl('Crystal socket',.68,.22,(0,3.48,0),BLACK,vertices=8)]
    for x in (-2.3,2.3):
        for z in (-2.3,2.3):
            objects += [armor('Obelisk',.57,.57,.32,1.8,.2,(x,z),BLACK),
                        gem('Network beacon',(.18,.16,.18),(x,1.89,z),RED)]
    objects += [box('Core portal',(1.08,1.1,.12),(0,.93,2.23),BLACK),
                box('Portal slit',(.13,.72,.025),(0,.93,2.3),RED)]
    merge('Nexus',objects)
    crystal = empty('crystal',(0,4.12,0))
    merge('Core crystal',[gem('Crystal',(.48,.64,.48),(0,4.12,0),RED)],crystal)
    ring = empty('ring',(0,3.93,0))
    objects = [torus('Field ring',1.01,.055,(0,3.93,0),MPLATE)]
    for x in (-1,1):
        objects.append(gem('Field node',(.12,.12,.18),(x,3.93,0),RED))
    merge('Field cage',objects,ring)
    save('m_hq')


def machine_factory():
    reset()
    objects = platform(machine=True)
    objects += [armor('Forge',5.12,4.5,.28,2.85,.3,(0,-.45),MACHINE),
                armor('Roof',4.8,4.1,2.85,3.29,.45,(0,-.45),BLACK),
                box('Bay',(3.16,2.21,.12),(0,1.46,1.86),BLACK)]
    for s in (-1,1):
        objects += [beam('Door gantry',(s*1.79,.31,2.03),(s*1.79,2.7,2.03),.21,MPLATE),
                    box('Door strip',(.08,2.13,.05),(s*1.56,1.47,1.96),RED,.007),
                    armor('Buttress',.47,2.3,.28,2.14,.12,(s*2.65,.1),MPLATE),
                    cyl('Exhaust stack',.26,.94,(s*1.96,3.77,-1.93),BLACK),
                    torus('Hot vent',.27,.07,(s*1.96,4.26,-1.93),ORANGE)]
    for z in (-1.65,-.75,.15):
        objects += [box('Roof fin',(3.3,.29,.31),(0,3.34,z),MPLATE),
                    box('Cooling seam',(2.5,.025,.12),(0,3.5,z),RED,.006)]
    objects += [box('Lintel',(3.64,.18,.27),(0,2.68,2.03),RED),
                box('Apron',(3.38,.11,.7),(0,.34,2.4),BLACK)]
    for x in (-1.2,0,1.2):
        objects.append(box('Conveyor rail',(.12,.04,.72),(x,.42,2.39),RED,.008))
    merge('Forge',objects)
    save('m_factory')


def environment():
    reset()
    objects = [cone('Trunk',.19,.09,1.7,(0,.85,0),'#79614b',7)]
    for i,(y,r,h) in enumerate(((1.25,1.03,1.65),(2.06,.8,1.53),(2.83,.51,1.22))):
        obj=cone('Fir crown',r,.02,h,(0,y,0),('#556c43','#647c4c','#789057')[i],7)
        obj.rotation_euler.z = i*.34
        objects.append(obj)
    merge('Fir',objects)
    save('env_tree')
    reset()
    objects=[gem('Boulder',(1.4,1.15,1.28),(0,.77,0),'#858781'),
             gem('Rock shelf',(.79,.61,.84),(.88,.4,.3),'#6e776e'),
             gem('Rock shard',(.43,.52,.61),(-.91,.32,.54),'#95958a')]
    merge('Rock',objects)
    save('env_rock')
    reset()
    # One material/mesh for instancing, with crystal facets rather than a primitive octahedron.
    objects=[cone('Crystal shaft',.3,.23,1.0,(0,.54,0),TEAL,5),
             cone('Crystal tip',.23,0,.5,(0,1.29,0),TEAL,5),
             cone('Side crystal',.15,0,.69,(.28,.37,.07),TEAL,5)]
    merge('Ore',objects)
    save('env_ore')


def quarry():
    reset()
    objects = []
    # Terraced, angular outcrop contained within a unit-radius footprint.
    for i, (radius, y, height) in enumerate(((.88, .17, .34), (.72, .43, .36), (.53, .69, .32))):
        obj = cone('Sedimentary terrace', radius, radius * .80, height, (i * .045, y, -i * .025), ('#62695f', '#7a8170', '#929581')[i], 9)
        # Sculpt the strata into a shared irregular silhouette, avoiding concentric cylinders.
        for vertex in obj.data.vertices:
            angle = math.atan2(vertex.co.y, vertex.co.x)
            factor = .77 + .14 * math.sin(angle * 3 + .4) + .08 * math.cos(angle * 5)
            vertex.co.x *= factor
            vertex.co.y *= factor * .85
            vertex.co.z += .035 * math.sin(angle * 3 + i)
        objects.append(obj)
    for x, z, scale in ((.6,.25,.22),(-.51,.42,.27),(.15,-.67,.23)):
        objects.append(gem('Talus', (scale, scale * .7, scale), (x, scale * .5, z), '#797d70'))
    merge('Quarry escarpment', objects)
    save('env_cliff')
    reset()
    objects = [box('Foundation', (1.3,.08,1.1), (0,.04,0), '#73786e', .03)]
    for x in (-.51,.51):
        objects.append(box('Broken pier', (.16,.66,.18), (x,.37,-.35), '#969889', .025))
    objects += [box('Broken lintel', (1.18,.13,.2), (0,.71,-.35), '#737a72', .025),
                box('Generator housing', (.57,.38,.45), (-.1,.27,.04), '#4a5a58', .05),
                cyl('Rust barrel', .13,.29,(.43,.23,.31),'#936447')]
    merge('Abandoned pump station', objects)
    save('env_ruin')


def cash_crate():
    reset()
    objects = [box('Skid',(1.65,.16,1.65),(0,.08,0),DARK),
               armor('Armored cash case',1.55,1.55,.16,1.2,.12,(0,0),'#a98135'),
               box('Lid',(1.61,.14,1.61),(0,1.22,0),YELLOW,.07),
               box('Credit seal',(.65,.025,.65),(0,1.305,0),'#5dd9a0',.02)]
    for s in (-1,1):
        objects += [box('Case strap',(.14,1.08,1.58),(s*.55,.72,0),STEEL,.015),
                    box('Lid strap',(.14,.025,1.58),(s*.55,1.305,0),DARK,.005),
                    box('Front cash marking',(.82,.3,.035),(0,.73,s*.755),'#5dd9a0',.01),
                    box('Latch',(.18,.3,.08),(s*.55,1.04,.79),YELLOW,.015)]
    for x in (-.17,.17):
        objects.append(box('Credit bars',(.09,.025,.38),(x,1.325,0),YELLOW,.005))
    merge('Cash crate',objects)
    save('prop_cash_crate')


def machine_engineer():
    reset()
    bob = empty('bob',(0,1.12,0))
    objects = [gem('Infiltrator pod',(.4,.28,.5),(0,1.13,-.06),MACHINE),
               armor('Dorsal plate',.6,.78,1.24,1.42,.22,(0,-.1),MPLATE),
               box('Optic band',(.34,.06,.05),(0,1.2,.4),ORANGE,.008),
               cyl('Probe mount',.11,.2,(0,1.05,.42),BLACK,'z',8),
               beam('Hacking probe',(0,1.05,.5),(0,.98,.98),.06,STEEL),
               cone('Probe tip',.05,.005,.16,(0,.97,1.04),ORANGE,6),
               torus('Probe coil',.08,.025,(0,1.02,.74),ORANGE,'z')]
    objects[-2].rotation_euler.x = math.pi/2
    xform(objects[-2])
    for s in (-1,1):
        shoulder, elbow, wrist = (s*.36,1.1,.12), (s*.52,.92,.42), (s*.3,.84,.72)
        objects += [cyl('Arm socket',.1,.14,shoulder,BLACK,'x',8),
                    beam('Upper manipulator',shoulder,elbow,.09,MPLATE),
                    gem('Elbow servo',(.075,.075,.075),elbow,MACHINE),
                    beam('Lower manipulator',elbow,wrist,.07,STEEL),
                    gem('Wrist servo',(.06,.06,.06),wrist,ORANGE),
                    beam('Claw finger',wrist,(s*.2,.8,.9),.04,MPLATE),
                    beam('Claw finger',wrist,(s*.38,.78,.88),.04,MPLATE),
                    cyl('Thruster',.13,.14,(s*.3,.95,-.32),BLACK,vertices=8),
                    beam('Antenna',(s*.14,1.38,-.32),(s*.22,1.62,-.5),.025,MPLATE)]
    merge('Infiltrator shell',objects,bob)
    ring = empty('ring',(0,-.26,0),bob)
    objects = [torus('Lift ring',.34,.035,(0,.86,0),ORANGE)]
    for a in (0,math.pi):
        objects.append(box('Ring tab',(.09,.08,.14),(math.sin(a)*.34,.86,math.cos(a)*.34),MPLATE))
    merge('Lift assembly',objects,ring)
    empty('muzzle',(0,-.15,.08+1.0),bob)
    save('m_engineer')


# ---------------------------------------------------------------- Tech structures
# Neutral pre-war sites, 4x4 cells (8x8 units). Each has a static foundation, an `intact`
# and a `wreck` pivot on the ground (the game grows intact.scale.y while repairing), and a
# `beacon` lamp mesh with its own material, recoloured per owner at runtime.
SLAB = .24
PLANES = {'xz': lambda u,v,w: (u,w,v), 'zx': lambda u,v,w: (v,w,u),
          'xy': lambda u,v,w: (u,v,w), 'zy': lambda u,v,w: (w,v,u)}


def xform(obj, rot=(0,0,0), pivot=(0,0,0), move=(0,0,0)):
    # Rotate about a game-space pivot (roll z, pitch x, then yaw y) and translate; baked into the mesh.
    R = Matrix.Rotation(rot[1],4,'Z') @ Matrix.Rotation(rot[0],4,'X') @ Matrix.Rotation(-rot[2],4,'Y')
    p = Vector(xyz(pivot))
    M = Matrix.Translation(p + Vector(xyz(move))) @ R @ Matrix.Translation(-p) @ obj.matrix_basis
    obj.data.transform(M)
    obj.matrix_basis = Matrix.Identity(4)
    return obj


def discard(objs):
    for obj in objs:
        bpy.data.objects.remove(obj)


def group(objs, rot=(0,0,0), pivot=(0,0,0), move=(0,0,0)):
    for obj in objs:
        xform(obj, rot, pivot, move)
    return objs


def solid(name, verts, faces, tint, bevel=0):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(v) for v in verts], [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    return finish(obj, tint, bevel)


def prism(name, pts, a, b, tint, plane='xz', bevel=0):
    # Extrude a 2D outline: 'xz' top-down (u=x, v=z, along y), 'zx' (u=z, v=x), 'xy' facing +Z, 'zy' facing +X.
    f, n = PLANES[plane], len(pts)
    verts = [f(u,v,a) for u,v in pts] + [f(u,v,b) for u,v in pts]
    faces = [tuple(range(n)), tuple(range(n,2*n))] + [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return solid(name, verts, faces, tint, bevel)


def tbox(name, size, pos, tint, rot=(0,0,0), bevel=.03):
    return xform(box(name, size, pos, tint, bevel), rot, pos)


def pipe(name, a, b, r, tint, vertices=10):
    a, b = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=(b-a).length, location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return finish(obj, tint, .015)


def ellipsoid(name, size, pos, tint, segments=16, rings=9):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=xyz(pos))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, tint)


def bowl(name, profile, tint, thickness=.08, segments=16, arc=math.tau, start=0):
    # Solid dish around +Y at the origin; profile is [(radius, y), ...] from the centre outward.
    full = arc >= math.tau - 1e-6
    n = segments if full else segments + 1
    rings = profile[1:]
    verts = []
    for off in (0, thickness):
        verts.append((0, profile[0][1] - off, 0))
        for r, y in rings:
            for i in range(n):
                a = start + arc*i/segments
                verts.append((math.cos(a)*r, y - off, math.sin(a)*r))
    L = len(verts)//2
    idx = lambda k, i: 1 + k*n + (i % n)
    faces = []
    for i in range(segments):
        j = i + 1
        faces += [(0, idx(0,i), idx(0,j)), (L, L+idx(0,j), L+idx(0,i))]
        for k in range(len(rings)-1):
            faces += [(idx(k,i), idx(k+1,i), idx(k+1,j), idx(k,j)),
                      (L+idx(k,i), L+idx(k,j), L+idx(k+1,j), L+idx(k+1,i))]
        k = len(rings) - 1
        faces.append((idx(k,i), L+idx(k,i), L+idx(k,j), idx(k,j)))
    if not full:
        for i in (0, n-1):
            chain = [0] + [idx(k,i) for k in range(len(rings))]
            for a, b in zip(chain, chain[1:]):
                faces.append((a, b, L+b, L+a))
    return solid(name, verts, faces, tint)


def dish_profile(radius, depth, rings=4):
    return [(radius*k/rings, depth*(k/rings)**2) for k in range(rings+1)]


def arch(name, x0, x1, zc, hw, h, y0, t, th0, th1, tint, segs=None):
    # Semi-elliptic shell band along X (hangar vaults and ribs); theta 0 = front foot, pi = rear foot.
    segs = segs or max(2, round((th1-th0)/math.pi*14))
    ring = []
    for k in range(segs+1):
        th = th0 + (th1-th0)*k/segs
        ring.append(((zc+hw*math.cos(th), y0+h*math.sin(th)), (zc+(hw-t)*math.cos(th), y0+(h-t)*math.sin(th))))
    verts = []
    for x in (x0, x1):
        for (zo,yo),(zi,yi) in ring:
            verts += [(x,yo,zo), (x,yi,zi)]
    m = 2*(segs+1)
    faces = []
    for k in range(segs):
        o0, i0, o1, i1 = 2*k, 2*k+1, 2*k+2, 2*k+3
        faces += [(o0,o1,o1+m,o0+m), (i0,i0+m,i1+m,i1), (o0,i0,i1,o1), (o0+m,o1+m,i1+m,i0+m)]
    e = 2*segs
    faces += [(0,m,m+1,1), (e,e+1,e+1+m,e+m)]
    return solid(name, verts, faces, tint)


def truss(cx, cz, y0, y1, r0, r1, sides, levels, leg, brace, tint, btint, panels=None, rot=math.pi/4, cross=True):
    # Tapered lattice tower; `panels` selects which storeys to build (for broken stumps).
    def corner(j, t):
        r, a = r0 + (r1-r0)*t, rot + j*math.tau/sides
        return (cx + math.cos(a)*r, y0 + (y1-y0)*t, cz + math.sin(a)*r)
    out = []
    for p in (range(levels) if panels is None else panels):
        t0, t1 = p/levels, (p+1)/levels
        for j in range(sides):
            k = (j+1) % sides
            out += [beam('Truss leg', corner(j,t0), corner(j,t1), leg, tint, 0),
                    beam('Truss rung', corner(j,t1), corner(k,t1), brace, btint, 0),
                    beam('Truss brace', corner(j,t0), corner(k,t1), brace*.75, btint, 0)]
            if cross:
                out.append(beam('Truss brace', corner(k,t0), corner(j,t1), brace*.75, btint, 0))
    return out


def blob(x, z, r, rnd, n=9):
    return [(x + math.cos(i*math.tau/n)*r*rnd.uniform(.6,1.1), z + math.sin(i*math.tau/n)*r*rnd.uniform(.6,1.1))
            for i in range(n)]


def scorch(x, z, r, seed, y=SLAB, tint=SOOT):
    return prism('Scorch mark', blob(x, z, r, random.Random(seed), 11), y, y+.014, tint)


def hazard(u0, u1, v, w, width, plane='xz', name='Hazard stripes'):
    # Faded yellow/black diagonal band on a surface (see prism planes); w is the surface level.
    out = [prism(name, [(u0,v-width/2),(u1,v-width/2),(u1,v+width/2),(u0,v+width/2)], w, w+.02, SOOT, plane)]
    step, h = width*1.15, width*.43
    u = u0 + .04
    while u + step*.5 + width*.9 <= u1 - .03:
        out.append(prism(name, [(u+width*.9,v-h),(u+width*.9+step*.5,v-h),(u+step*.5,v+h),(u,v+h)],
                         w+.012, w+.032, HAZARD, plane))
        u += step
    return out


def rubble(cx, cz, spread, n, seed, tints, size=.35, y=SLAB):
    rnd, out = random.Random(seed), []
    for i in range(n):
        s = size*rnd.uniform(.55,1.4)
        x = max(-3.88+s, min(3.88-s, cx + rnd.uniform(-spread,spread)))
        z = max(-3.88+s, min(3.88-s, cz + rnd.uniform(-spread,spread)*.8))
        tint = tints[i % len(tints)]
        if i % 3:
            o = gem('Rubble',(s,s*rnd.uniform(.45,.8),s*rnd.uniform(.7,1.1)),(x,y+s*.25,z),tint)
            out.append(xform(o,(0,rnd.uniform(0,3.1),rnd.uniform(-.3,.3)),(x,y,z)))
        else:
            out.append(tbox('Concrete shard',(s*1.7,s*.3,s*1.1),(x,y+s*.3,z),tint,
                            (rnd.uniform(-.35,.35),rnd.uniform(0,3.1),rnd.uniform(-.35,.35)),.02))
    return out


def tech_slab(seed):
    rnd = random.Random(seed)
    objs = [box('Site slab',(7.8,.2,7.8),(0,.1,0),CONCRETE_D,.06)]
    tones = (CONCRETE, '#84837b', '#918f86', '#7e7d75')
    for i,(x,z) in enumerate(((-1.93,-1.93),(1.93,-1.93),(-1.93,1.93),(1.93,1.93))):
        objs.append(box('Pour panel',(3.78,.05,3.78),(x,.215,z),tones[(i+seed)%4],.015))
    for i in range(6):
        x, z, a = rnd.uniform(-3.3,3.3), rnd.uniform(-3.3,3.3), rnd.uniform(0,math.pi)
        for k in range(3):
            a += rnd.uniform(-.8,.8)
            nx, nz = max(-3.7,min(3.7,x+math.cos(a)*.4)), max(-3.7,min(3.7,z+math.sin(a)*.4))
            dx, dz = (nz-z)*.045, (x-nx)*.045
            objs.append(prism('Crack',[(x-dx,z-dz),(nx-dx*.4,nz-dz*.4),(nx+dx*.4,nz+dz*.4),(x+dx,z+dz)],SLAB-.01,SLAB+.004,SOOT))
            x, z = nx, nz
    for i in range(4):
        objs.append(prism('Weather stain', blob(rnd.uniform(-3,3), rnd.uniform(-3,3), rnd.uniform(.35,.7), rnd), SLAB, SLAB+.006, '#74726b'))
    objs += hazard(-3.72,-2.2,3.7,SLAB,.22) + hazard(2.2,3.72,3.7,SLAB,.22)
    return objs


def beacon_post(x, z, h=1.35):
    top = SLAB + .3 + h
    parts = [box('Beacon plinth',(.55,.3,.55),(x,SLAB+.15,z),CONCRETE_L,.04),
             box('Plinth stripe',(.57,.07,.57),(x,SLAB+.22,z),HAZARD,.01),
             cyl('Beacon mast',.065,h,(x,SLAB+.3+h/2,z),IRON,vertices=8),
             cyl('Lamp seat',.21,.07,(x,top+.035,z),DARK,vertices=8),
             cone('Lamp hood',.22,.1,.12,(x,top+.07+.32+.06,z),DARK,8)]
    for i in range(3):
        a = i*math.tau/3 + .5
        parts.append(beam('Lamp cage',(x+math.cos(a)*.19,top+.07,z+math.sin(a)*.19),
                          (x+math.cos(a)*.19,top+.4,z+math.sin(a)*.19),.03,DARK))
    return parts, (x, top+.07, z)


def beacon_lamp(x, y, z):
    # Owner light: its own material and no vertex colours, so the runtime tint is not multiplied away.
    obj = cyl('beacon', .16, .32, (x, y+.16, z), WHITE, vertices=8)
    obj.data.color_attributes.remove(obj.data.color_attributes['Color'])
    mat = bpy.data.materials.get('Beacon')
    if not mat:
        mat = bpy.data.materials.new('Beacon')
        mat.use_nodes = True
        mat.use_backface_culling = True
        shader = mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = color('#d4d8d6')
        shader.inputs['Emission Color'].default_value = color('#d4d8d6')
        shader.inputs['Emission Strength'].default_value = .8
        shader.inputs['Roughness'].default_value = .35
        shader.inputs['Metallic'].default_value = 0
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.name = 'beacon'
    obj.data.name = 'beacon'
    return obj


# --- Missile silo: armoured launch deck with two hexagonal blast doors, control bunker, stacks, mast.
SILO_SHAFTS = ((-1.65,-1.3), (1.65,-1.3))


def silo_door(side, R=1.06, g=.03):
    h = R*math.sqrt(3)/2
    pts = [(side*g,-h),(side*R/2,-h),(side*R,0),(side*R/2,h),(side*g,h)]
    return [prism('Blast door', pts, 0, .14, DOOR)] + hazard(-h+.12, h-.12, side*.22, .14, .24, 'zx')


def silo_mast(x, y, z):
    parts = truss(x, z, y, y+2.75, .3, .12, 3, 4, .07, .04, IRON, STEEL)
    parts += [cyl('Whip antenna',.025,.45,(x,y+2.97,z),STEEL,vertices=6),
              beam('Antenna yard',(x-.45,y+2.3,z),(x+.45,y+2.3,z),.05,STEEL),
              box('Panel antenna',(.12,.42,.08),(x-.45,y+2.1,z),CONCRETE_L,.01),
              box('Panel antenna',(.12,.42,.08),(x+.45,y+2.1,z),CONCRETE_L,.01)]
    d = bowl('Relay dish', dish_profile(.34,.13,2), CONCRETE_L, .04, 12)
    parts.append(xform(d,(1.05,0,0),(0,0,0),(x,y+1.55,z+.2)))
    return parts


def silo_site():
    base = tech_slab(1)
    base.append(armor('Launch deck',7.2,4.8,SLAB,.8,.45,(0,-1.25),CONCRETE))
    for cx,cz in SILO_SHAFTS:
        base += [cyl('Shaft collar',1.22,.12,(cx,.86,cz),CONCRETE_L,vertices=6),
                 cyl('Shaft void',1.0,.02,(cx,.925,cz),BLACK,vertices=6)]
        for dz in (-1.1,1.1):
            base.append(box('Door rail',(2.9,.06,.1),(cx,.83,cz+dz),STEEL,.01))
    base += hazard(-3.0,3.0,.66,.8,.26)
    for x in (-3.0,3.0):
        base.append(box('Deck bollard',(.26,.3,.26),(x,.95,.66),HAZARD,.03))
    lamp_parts, lamp = beacon_post(-3.4, 3.4)
    base += lamp_parts

    bx, bz = -.15, 2.6
    intact = []
    for cx,cz in SILO_SHAFTS:
        for s in (-1,1):
            intact += group(silo_door(s), move=(cx,.9,cz))
            intact.append(box('Door drive',(.45,.32,.85),(cx+s*1.42,.97,cz),IRON))
            intact.append(box('Drive piston',(.5,.1,.1),(cx+s*1.05,1.0,cz),STEEL,.01))
    for x in (-3.05,3.05):
        intact += [cyl('Stack collar',.38,.2,(x,.9,-3.05),CONCRETE_L),
                   cyl('Vent stack',.3,2.5,(x,2.05,-3.05),RUST),
                   torus('Stack band',.31,.045,(x,1.6,-3.05),RUST_D),
                   torus('Stack band',.31,.045,(x,2.6,-3.05),RUST_D),
                   cone('Vent cowl',.45,.22,.32,(x,3.45,-3.05),IRON),
                   cyl('Cowl mouth',.2,.02,(x,3.62,-3.05),SOOT)]
    intact += [armor('Control bunker',3.4,1.9,SLAB,1.6,.5,(bx,bz),CONCRETE),
               armor('Bunker roof',2.95,1.45,1.6,1.8,.24,(bx,bz),CONCRETE_D),
               box('Observation slit',(1.6,.18,.08),(bx-.35,1.22,3.37),'#5f8890',.01),
               box('Slit brow',(1.9,.1,.22),(bx-.35,1.38,3.38),CONCRETE_L,.02),
               box('Entry vestibule',(.9,1.05,.55),(1.1,.765,3.5),CONCRETE_L),
               box('Bunker door',(.56,.8,.05),(1.1,.66,3.79),DOOR,.01),
               cyl('Roof hatch',.26,.1,(.05,1.84,2.2),IRON),
               box('Roof louvre',(.7,.22,.5),(.5,1.9,2.95),IRON,.02),
               cyl('Dome collar',.68,.14,(-.85,1.85,2.5),IRON,vertices=16)]
    dome = bowl('Tracking dome',[(.62*math.sin(p),.62*(1-math.cos(p))) for p in (0,.5,1.0,1.35,math.pi/2)],'#cfccc0',.05,16)
    intact.append(xform(dome,(math.pi,0,0),(0,0,0),(-.85,2.54,2.5)))
    intact += hazard(.68,1.52,1.18,3.775,.14,'xy')
    for x in (-.35,.15):
        intact.append(pipe('Command conduit',(x,.95,.4),(x,1.25,1.85),.07,STEEL))
    intact += silo_mast(.85,1.8,2.25)

    wreck = []
    # Left shaft: doors blown clear, a scorched missile jammed in the open silo.
    lcx, lcz = SILO_SHAFTS[0]
    wreck += group(silo_door(-1), (.22,.8,.3), (0,0,0), (-2.55,1.0,.1))
    wreck += group(silo_door(1), (-1.05,.35,.05), (0,0,0), (-2.6,1.06,1.75))
    wreck.append(torus('Burnt rim',1.06,.06,(lcx,.93,lcz),SOOT))
    for i in range(5):
        a = i*math.tau/5 + .3
        wreck.append(scorch(lcx+math.cos(a)*1.45, lcz+math.sin(a)*1.35, .42, 40+i, .8))
    missile = [cyl('Missile body',.5,2.4,(0,1.25,0),'#bdb9ab',vertices=12),
               cone('Missile nose',.5,.06,.85,(0,2.87,0),'#bdb9ab',12),
               torus('Missile band',.51,.05,(0,2.1,0),SOOT),
               box('Missile fin',(.1,.6,1.3),(0,.4,0),RUST_D,.02),
               box('Missile fin',(1.3,.6,.1),(0,.4,0),RUST_D,.02)]
    wreck += group(missile, (.12,0,-.28), (0,0,0), (lcx-.15,.16,lcz))
    # Right shaft: one leaf shoved aside, the other torn up on its edge.
    rcx, rcz = SILO_SHAFTS[1]
    wreck += group(silo_door(-1), (0,0,.1), (0,0,0), (rcx-.35,.92,rcz))
    wreck += group(silo_door(1), (0,0,-1.05), (1.06,0,0), (rcx,.92,rcz))
    wreck.append(tbox('Bent drive',(.45,.32,.85),(rcx+1.42,.95,rcz),IRON,(.2,.3,.25)))
    wreck.append(box('Door drive',(.45,.32,.85),(0,.97,-1.3),IRON))
    # Bunker caved in.
    wreck += [armor('Bunker ruin',3.4,1.9,SLAB,.85,.3,(bx,bz),CONCRETE),
              tbox('Wall stump',(.45,1.25,1.5),(bx-1.5,.8,bz),CONCRETE,(0,0,.08)),
              tbox('Wall stump',(1.3,.95,.42),(bx+.85,.72,bz-.72),CONCRETE,(.05,.1,-.06)),
              tbox('Collapsed roof',(2.9,.24,1.5),(bx+.15,1.0,bz+.15),CONCRETE_D,(.24,.08,-.2)),
              tbox('Roof shard',(1.1,.18,.9),(bx-1.2,.95,bz+.65),CONCRETE_D,(-.3,.5,.35)),
              box('Vestibule stump',(.9,.5,.55),(1.1,.49,3.5),CONCRETE_L),
              tbox('Fallen door',(.56,.05,.8),(1.6,.32,3.4),DOOR,(.1,.6,0),.01)]
    shell = bowl('Broken dome',[(.62*math.sin(p),.62*(1-math.cos(p))) for p in (0,.5,1.0,1.35,math.pi/2)],'#b8b5a9',.05,16,3.6,.4)
    wreck.append(xform(shell,(math.pi-.5,.3,.35),(0,0,0),(-1.15,1.25,2.75)))
    wreck += rubble(bx,bz+.4,1.6,16,11,(CONCRETE,CONCRETE_L,CONCRETE_D),.28)
    # Stacks: one snapped and fallen, one buckled.
    wreck += [cyl('Stack collar',.38,.2,(-3.05,.9,-3.05),CONCRETE_L),
              cyl('Stack stump',.3,.9,(-3.05,1.25,-3.05),RUST),
              tbox('Torn edge',(.5,.2,.3),(-3.0,1.72,-3.1),RUST_D,(.4,.3,.5)),
              cyl('Fallen stack',.3,1.6,(-2.0,1.12,-2.75),RUST,'x'),
              xform(torus('Stack band',.31,.045,(-1.55,1.12,-2.75),RUST_D,'z'),(0,math.pi/2,0),(-1.55,1.12,-2.75))]
    cowl = cone('Vent cowl',.45,.22,.32,(0,0,0),IRON)
    wreck.append(xform(cowl,(0,0,1.4),(0,0,0),(-1.05,1.15,-2.75)))
    bent = [cyl('Vent stack',.3,1.3,(3.05,1.45,-3.05),RUST), cyl('Stack collar',.38,.2,(3.05,.9,-3.05),CONCRETE_L)]
    top = [cyl('Vent stack',.3,1.1,(3.05,2.65,-3.05),RUST), cone('Vent cowl',.45,.22,.32,(3.05,3.35,-3.05),IRON)]
    wreck += bent + group(top,(.35,0,.55),(3.05,2.1,-3.05))
    # Antenna mast toppled across the front.
    mast = silo_mast(0,0,0)
    wreck += group(mast,(1.45,1.2,0),(0,0,0),(.5,1.0,2.2))
    wreck += [scorch(.0,.9,.9,77), scorch(2.5,2.0,.6,78), scorch(-1.0,-2.9,.7,79,.8)]
    return base, intact, wreck, lamp


# --- Ion cannon uplink: tapered lattice pylon, copper coils and a sky-facing focusing dish.
ION_Z = -.6


def ion_half(y):
    return 1.5 + (.55-1.5)*(y-.75)/(5.6-.75)


def ion_head(y):
    parts = [cyl('Gimbal hub',.75,.35,(0,y+.15,0),DARK,vertices=12),
             cone('Dish mount',.55,.25,.35,(0,y+.45,0),IRON,10)]
    d = bowl('Focusing dish', dish_profile(2.35,.95), '#b9b5a6', .1, 16)
    parts.append(xform(d, move=(0,y+.6,0)))
    parts += [torus('Dish rim',2.35,.07,(0,y+1.55,0),IRON),
              torus('Panel seam',1.55,.03,(0,y+.6+.95*(1.55/2.35)**2+.01,0),DARK),
              torus('Panel seam',.8,.03,(0,y+.6+.95*(.8/2.35)**2+.01,0),DARK)]
    focus = (0,y+2.35,0)
    for i in range(3):
        a = i*math.tau/3 + math.pi/2
        parts.append(beam('Feed strut',(math.cos(a)*2.28,y+1.55,math.sin(a)*2.28),focus,.07,IRON))
    parts += [cone('Emitter horn',.1,.24,.4,(0,y+2.25,0),DARK,10),
              torus('Focus coil',.27,.06,(0,y+2.35,0),COPPER),
              gem('Focus crystal',(.15,.2,.15),(0,y+2.6,0),TEAL)]
    return parts


def ion_site():
    base = tech_slab(2)
    base.append(armor('Pylon plinth',4.4,4.4,SLAB,.75,.35,(0,ION_Z),CONCRETE))
    for sx in (-1,1):
        for sz in (-1,1):
            base.append(box('Leg footing',(.62,.14,.62),(sx*1.5,.8,ION_Z+sz*1.5),CONCRETE_L,.03))
        base += [box('Capacitor pad',(1.5,.1,1.5),(sx*3.0,.29,-3.0),CONCRETE_L),
                 tbox('Cable trench',(.36,.05,1.2),(sx*2.15,.26,-2.2),IRON,(0,sx*.75,0),.01)]
    base += hazard(-1.7,1.7,1.25,.75,.24)
    base.append(box('Hut pad',(2.3,.08,1.75),(2.5,.28,2.5),CONCRETE_L,.02))
    lamp_parts, lamp = beacon_post(-3.4, 3.4)
    base += lamp_parts

    intact = truss(0,ION_Z,.75,5.6,1.5*math.sqrt(2),.55*math.sqrt(2),4,3,.24,.12,RUST_D,IRON)
    intact.append(cyl('Ion core',.32,5.2,(0,.75+2.6,ION_Z),STEEL))
    for y in (2.9,3.9,4.9):
        a = ion_half(y)
        r = a*math.sqrt(2) + .22
        intact.append(torus('Coil ring',r,.12,(0,y,ION_Z),COPPER))
        for k in range(4):
            ang = math.pi/4 + k*math.pi/2
            intact.append(beam('Coil standoff',(math.cos(ang)*a*math.sqrt(2),y,ION_Z+math.sin(ang)*a*math.sqrt(2)),
                               (math.cos(ang)*r,y,ION_Z+math.sin(ang)*r),.07,'#cfd3c8'))
    intact += group(ion_head(5.6), move=(0,0,ION_Z))
    for sx in (-1,1):
        x, z = sx*3.0, -3.0
        intact += [cyl('Capacitor drum',.55,1.6,(x,1.14,z),'#9b998c',12),
                   torus('Capacitor band',.57,.05,(x,.75,z),COPPER),
                   torus('Capacitor band',.57,.05,(x,1.5,z),COPPER),
                   cone('Drum cap',.55,.28,.22,(x,2.05,z),IRON,12),
                   cyl('Insulator',.09,.36,(x,2.34,z),'#cfd3c8',8),
                   torus('Insulator skirt',.13,.035,(x,2.3,z),'#cfd3c8'),
                   pipe('Power conduit',(sx*2.55,.55,-2.55),(sx*1.6,.95,ION_Z-1.6),.11,STEEL),
                   beam('Feed cable',(x,2.52,z),(sx*1.25,2.37,ION_Z-1.25),.045,DARK)]
    hx, hz = 2.5, 2.5
    intact += [box('Control hut',(1.9,1.3,1.4),(hx,.97,hz),CONCRETE_L,.06),
               box('Hut roof',(2.1,.14,1.6),(hx,1.69,hz),'#686a64'),
               box('Hut window',(.9,.32,.04),(hx-.3,1.2,hz+.71),GLASS),
               box('Hut door',(.42,.8,.04),(hx+.55,.72,hz+.71),DOOR),
               box('Roof unit',(.6,.3,.5),(hx+.4,1.91,hz-.2),IRON),
               cyl('Hut antenna',.03,1.0,(hx-.75,2.26,hz-.45),STEEL,vertices=6),
               pipe('Control line',(hx-.7,.5,hz-.75),(1.0,.9,ION_Z+1.5),.08,DARK)]

    wreck = truss(0,ION_Z,.75,5.6,1.5*math.sqrt(2),.55*math.sqrt(2),4,3,.24,.12,RUST_D,IRON,panels=[0])
    a1 = ion_half(2.37)
    for sx, sz, bend in ((-1,-1,(-.2,3.5,.1)), (1,-1,(.5,3.2,-.4)), (-1,1,(-.9,2.9,.4))):
        p0 = (sx*a1, 2.37, ION_Z+sz*a1)
        wreck.append(beam('Bent leg', p0, (p0[0]+bend[0], bend[1], p0[2]+bend[2]), .22, RUST_D))
    wreck += [cyl('Core stump',.32,2.0,(0,1.75,ION_Z),STEEL),
              tbox('Core shard',(.4,.5,.3),(.1,2.85,ION_Z),STEEL,(.3,.4,.5))]
    # Upper storey and focusing head lie across the front of the pad.
    top = truss(0,0,0,1.62,ion_half(3.98)*math.sqrt(2),.55*math.sqrt(2),4,1,.24,.12,RUST_D,IRON)
    top += [cyl('Gimbal hub',.6,.3,(0,1.78,0),IRON,vertices=12), torus('Coil ring',ion_half(4.9)*math.sqrt(2)+.22,.12,(0,.92,0),COPPER)]
    wreck += group(top,(1.4,-.75,.0),(0,0,0),(-.9,1.15,1.1))
    # The dish slumped onto the broken pylon, a wedge torn out of it.
    dish = [bowl('Broken dish', dish_profile(2.35,.95), '#b3afa0', .1, 16, 4.7, 2.2),
            xform(arch('Torn rim',-.04,.04,0,2.39,2.39,0,.09,.7,3.5,IRON),(0,0,math.pi/2),(0,0,0),(0,.95,0))]
    wreck += group(dish,(.55,0,-.45),(0,0,0),(.55,2.05,-.95))
    wreck += [xform(torus('Fallen coil',ion_half(2.9)*math.sqrt(2)+.22,.12,(0,.88,ION_Z),COPPER),(.1,0,-.07),(0,.88,ION_Z)),
              xform(torus('Fallen coil',1.1,.12,(0,0,0),COPPER,'z'),(0,.5,.35),(0,0,0),(-2.35,1.27,-1.2))]
    # Capacitors: one toppled, one standing burnt out.
    wreck += [cyl('Capacitor drum',.55,1.6,(-2.55,.85,-3.1),'#7e7c72','x',12),
              xform(torus('Capacitor band',.57,.05,(-3.0,.85,-3.1),COPPER,'z'),(0,math.pi/2,0),(-3.0,.85,-3.1)),
              cyl('Capacitor drum',.55,1.25,(3.0,.96,-3.0),'#7e7c72',12),
              tbox('Split cap',(.9,.12,.9),(3.0,1.62,-3.0),IRON,(.35,.2,-.25)),
              scorch(3.0,-3.0,.95,50,.34)]
    wreck += [box('Hut ruin',(1.9,.65,1.4),(2.5,.65,2.5),CONCRETE_L,.06),
              tbox('Hut wall',(.2,1.2,1.4),(1.65,.9,2.5),CONCRETE_L,(0,0,.1)),
              tbox('Caved roof',(2.1,.14,1.6),(2.6,1.05,2.4),DARK,(.25,.15,-.3))]
    wreck += rubble(.4,-.2,2.2,14,21,(CONCRETE,RUST_D,IRON,CONCRETE_L),.3)
    wreck += [scorch(-.3,-.1,1.2,51,.75), scorch(-1.8,1.9,.8,52)]
    return base, intact, wreck, lamp


# --- Mammoth tank plant: armoured hangar, wide blast door, gantry crane holding a twin-gun turret.
MAMMOTH_Z = -1.2


def mammoth_turret(y, z):
    parts = [armor('Mammoth turret',2.2,2.3,y,y+.65,.6,(0,z),GUNMETAL),
             cyl('Commander cupola',.3,.16,(-.5,y+.72,z-.4),IRON),
             box('Turret vision block',(.5,.12,.2),(.4,y+.68,z+.35),DARK,.02)]
    for x in (-.42,.42):
        parts += [cyl('Gun sleeve',.22,.5,(x,y+.3,z+1.2),GUNMETAL,'z'),
                  cyl('Twin cannon',.13,2.3,(x,y+.3,z+2.3),IRON,'z'),
                  box('Muzzle brake',(.32,.28,.34),(x,y+.3,z+3.4),DARK,.03)]
    return parts


def mammoth_site():
    hz = MAMMOTH_Z
    base = tech_slab(3)
    base += [box('Vehicle apron',(5.7,.04,2.35),(0,.26,2.55),CONCRETE_L,.02),
             box('Hangar floor',(7.0,.03,4.6),(0,.255,hz),'#5d5c56',.01)]
    for x in (-1.55,-.85,.85,1.55):
        base.append(box('Track scuffs',(.36,.012,2.3),(x,.285,2.55),'#5e5d57',0))
    for sx in (-1,1):
        base += hazard(1.45,3.65,sx*2.6,.28,.26,'zx')
        base.append(box('Crane rail',(.34,.06,4.8),(sx*3.7,.27,hz),STEEL,.01))
    lamp_parts, lamp = beacon_post(-3.45, 3.45)
    base += lamp_parts

    intact = [armor('Hangar shell',7.2,4.8,SLAB,3.3,.5,(0,hz),CONCRETE),
              armor('Roof armor',6.9,4.5,3.3,3.75,.9,(0,hz),IRON),
              box('Assembly hatch',(2.4,.03,1.5),(0,3.765,-1.3),BLACK,0)]
    intact += hazard(-1.35,1.35,-.42,3.75,.2) + hazard(-1.35,1.35,-2.18,3.75,.2)
    for sx in (-1,1):
        intact += hazard(-2.08,-.52,sx*1.33,3.75,.2,'zx')
        intact += [box('Roof rib',(.3,.2,3.4),(sx*2.25,3.83,hz),RUST_D),
                   box('Roof vent',(.8,.25,.6),(sx*2.25,3.95,hz+.9),IRON,.02),
                   box('Gate pillar',(.6,3.35,.75),(sx*2.75,SLAB+1.675,1.4),CONCRETE_L)]
        for i, y in enumerate((.5,.85,1.2,1.55,1.9,2.25,2.6,2.95)):
            intact.append(box('Pillar marking',(.62,.34,.04),(sx*2.75,y,1.785),HAZARD if i%2 else SOOT,.005))
        for z in (-3.3,.9):
            intact += [box('Crane leg',(.22,4.95,.3),(sx*3.7,SLAB+2.475,z),CRANE),
                       beam('Knee brace',(sx*3.7,4.3,z),(sx*3.7,5.05,z-.75 if z>0 else z+.75),.12,CRANE)]
        intact.append(box('Crane runway',(.3,.3,4.7),(sx*3.7,5.2,hz),CRANE))
    intact += [box('Gate lintel',(6.1,.65,.8),(0,3.45,1.4),RUST_D),
               box('Blast door',(4.9,2.88,.16),(0,SLAB+1.44,1.3),DOOR),
               box('Door seam',(.04,2.8,.03),(0,1.68,1.39),BLACK,0)]
    intact += hazard(-2.9,2.9,3.45,1.8,.34,'xy') + hazard(-2.4,2.4,.52,1.38,.26,'xy')
    for x in (-1.63,-.82,.82,1.63):
        intact.append(box('Door rib',(.12,2.2,.06),(x,1.95,1.4),IRON,.01))
    for z in (-1.48,-1.02):
        intact.append(box('Crane bridge',(7.68,.36,.22),(0,5.45,z),CRANE))
    intact += [box('Crane trolley',(1.0,.3,.95),(.1,5.78,-1.25),IRON),
               box('Hoist drum',(.7,.2,.5),(.1,5.53,-1.25),DARK)]
    intact += hazard(-3.6,3.6,5.45,-.91,.2,'xy')
    for x in (-.35,.55):
        for z in (-1.5,-1.0):
            intact.append(beam('Hoist cable',(x,5.4,z),(x*1.6,4.62,z-.2),.03,DARK))
    intact += mammoth_turret(4.0,-1.4)
    for x in (1.7,2.55):
        intact += [cyl('Exhaust stack',.27,1.8,(x,4.6,-2.65),RUST),
                   torus('Stack band',.28,.045,(x,4.4,-2.65),RUST_D),
                   torus('Stack lip',.29,.06,(x,5.5,-2.65),SOOT),
                   cyl('Stack mouth',.22,.02,(x,5.5,-2.65),SOOT)]

    wreck = [armor('Shell stump',7.2,4.8,SLAB,1.25,.2,(0,hz),CONCRETE),
             box('Exposed floor',(6.4,.04,4.0),(0,1.26,hz),'#45443f',.01),
             tbox('Rear wall fragment',(2.7,2.7,.5),(-2.0,1.6,-3.35),CONCRETE,(0,0,.04)),
             tbox('Rear wall fragment',(1.6,1.9,.5),(1.6,1.3,-3.35),CONCRETE,(0,0,-.06)),
             tbox('Side wall fragment',(.5,2.1,2.3),(3.35,1.3,-2.1),CONCRETE,(0,0,-.08)),
             tbox('Side wall fragment',(.5,1.7,1.5),(-3.35,1.1,-.3),CONCRETE,(0,0,.1)),
             box('Pillar stump',(.6,2.4,.75),(-2.75,SLAB+1.2,1.4),CONCRETE_L),
             box('Pillar stump',(.6,.9,.75),(2.75,SLAB+.45,1.4),CONCRETE_L),
             tbox('Fallen pillar',(.6,2.6,.75),(1.15,.6,1.45),CONCRETE_L,(.1,.15,1.48)),
             tbox('Fallen lintel',(4.6,.6,.75),(-.6,1.5,1.85),RUST_D,(0,.18,-.42)),
             tbox('Torn blast door',(4.6,2.6,.16),(.3,.7,2.3),DOOR,(-1.3,.1,.05)),
             tbox('Roof plate',(3.0,.3,2.3),(-1.6,1.95,-1.7),IRON,(.35,.2,.3)),
             tbox('Roof plate',(1.6,.3,1.9),(2.4,1.75,-1.4),IRON,(-.2,-.2,-.55)),
             tbox('Bent roof rib',(.3,.2,3.0),(-2.3,2.35,-1.9),RUST_D,(.5,.1,-.2))]
    for i, y in enumerate((.5,.85,1.2,1.55,1.9,2.25)):
        wreck.append(box('Pillar marking',(.62,.34,.04),(-2.75,y,1.785),HAZARD if i%2 else SOOT,.005))
    door = hazard(-2.2,2.2,-.95,.08,.26,'xy') + [box('Door rib',(.12,2.2,.06),(x,0,.1),IRON,.01) for x in (-1.63,-.82,.82,1.63)]
    wreck += group(door,(-1.3,.1,.05),(0,0,0),(.3,.7,2.3))
    # Crane: one rear leg still standing, the bridge slewed across the back wall.
    wreck += [box('Crane leg',(.22,4.95,.3),(-3.7,SLAB+2.475,-3.3),CRANE),
              tbox('Buckled crane leg',(.22,2.6,.3),(3.7,1.54,-3.3),CRANE,(0,0,.06)),
              tbox('Crane leg stub',(.22,1.3,.3),(-3.7,.89,.9),CRANE,(0,0,.1)),
              tbox('Crane leg stub',(.22,.8,.3),(3.7,.64,.9),CRANE,(0,0,-.12)),
              beam('Hanging runway',(-3.7,5.1,-3.3),(-3.7,.9,1.0),.3,CRANE),
              beam('Fallen bridge',(-3.55,4.95,-3.0),(3.3,.6,-2.5),.36,CRANE),
              beam('Fallen leg',(-3.4,.4,1.75),(-1.4,.35,3.5),.24,CRANE),
              tbox('Crane trolley',(1.0,.3,.95),(2.95,.45,2.95),IRON,(.2,.5,.15))]
    # The turret dropped through the roof into the hall, one cannon bent.
    turret = mammoth_turret(0,0)
    discard(turret[6:])
    turret = turret[:6] + [beam('Bent cannon',(.42,.3,1.4),(.6,.4,2.6),.24,IRON), beam('Bent cannon',(.6,.4,2.6),(1.2,.15,3.4),.24,IRON)]
    wreck += group(turret,(.12,-.65,-.18),(0,0,0),(.4,1.35,-1.35))
    wreck += [tbox('Fallen stack',(.54,1.7,.54),(.2,2.0,-3.05),RUST,(0,.3,1.25)),
              cyl('Stack stump',.27,.8,(2.55,1.65,-2.65),RUST)]
    wreck += rubble(0,hz+.4,2.6,14,31,(CONCRETE,CONCRETE_L,IRON),.34,1.25)
    wreck += rubble(0,2.3,2.4,6,32,(CONCRETE,CONCRETE_L),.28)
    wreck += [scorch(-1.0,2.3,.8,60), scorch(1.9,3.1,.6,61)]
    return base, intact, wreck, lamp


# --- Juggernaut walker plant: open assembly scaffold around a half-built giant leg and hip frame.
JUG_COLS = [(sx*3.25, z) for sx in (-1,1) for z in (-3.15,1.75)]


def jug_leg(lx):
    # Foot, shin, knee and thigh of the walker, knee forward, in assembly position.
    parts = [armor('Mech foot',1.6,2.3,.3,1.0,.5,(lx,.25),PRIMER),
             box('Heel spur',(.6,.4,.5),(lx,.55,-1.05),GUNMETAL,.05),
             cyl('Ankle joint',.42,1.1,(lx,1.15,.15),DARK,'x',12)]
    for dx in (-.45,0,.45):
        parts.append(tbox('Toe claw',(.3,.3,.6),(lx+dx,.48,1.55),GUNMETAL,(.35,0,0),.04))
    parts.append(xform(armor('Mech shin',1.1,.95,0,2.55,.3,(0,0),PRIMER),(.24,0,0),(0,0,0),(lx,1.15,.15)))
    parts += [cyl('Knee joint',.55,1.25,(lx,3.63,.76),DARK,'x',12),
              tbox('Knee guard',(1.05,1.05,.25),(lx,3.75,1.32),PRIMER,(-.35,0,0),.05),
              xform(armor('Mech thigh',1.3,1.05,0,2.6,.3,(0,0),PRIMER),(-.55,0,0),(0,0,0),(lx,3.63,.76))]
    for dx in (-.62,.62):
        parts += [pipe('Shin piston',(lx+dx,1.6,-.05),(lx+dx,3.3,.42),.08,STEEL),
                  pipe('Thigh piston',(lx+dx*1.1,4.0,.35),(lx+dx*1.1,5.4,-.5),.09,STEEL)]
    return parts


def jug_hip():
    parts = [armor('Hip frame',3.4,1.6,5.55,6.45,.35,(0,-.65),GUNMETAL),
             cyl('Pelvis ring',.8,.22,(0,6.56,-.65),DARK,vertices=12),
             cyl('Hip joint',.55,1.3,(-1.0,5.85,-.6),DARK,'x',12),
             cyl('Empty socket',.55,.4,(1.25,5.85,-.6),BLACK,'x',12),
             xform(torus('Socket flange',.6,.06,(1.05,5.85,-.6),HAZARD,'z'),(0,math.pi/2,0),(1.05,5.85,-.6))]
    for i, (x, z) in enumerate(((.9,-.4),(1.15,-.75),(1.4,-.5))):
        parts += [beam('Loose cable',(x,5.5,z),(x+.15,4.8,z+.1),.06,SOOT if i else RUST),
                  beam('Loose cable',(x+.15,4.8,z+.1),(x-.05,4.25,z+.25),.06,SOOT if i else RUST)]
    return parts


def jug_site():
    base = tech_slab(4)
    base += [box('Assembly floor',(6.9,.06,5.7),(0,.27,-.65),'#4a4d49',.02),
             box('Turntable',(3.0,.03,3.0),(-.6,.31,-.2),IRON,.01)]
    base += hazard(-3.0,3.0,2.05,.3,.24)
    for x,z in JUG_COLS:
        base.append(box('Column footing',(.8,.16,.8),(x,.38,z),CONCRETE_L,.03))
    lamp_parts, lamp = beacon_post(-3.45, 3.45)
    base += lamp_parts

    intact = []
    for x,z in JUG_COLS:
        intact.append(box('Scaffold column',(.42,6.74,.42),(x,3.83,z),RUST))
    intact.append(box('Top girder',(6.92,.4,.36),(0,7.0,-3.15),RUST_D))
    for sx in (-1,1):
        intact.append(box('Top girder',(.36,.4,4.5),(sx*3.25,7.0,-.7),RUST_D))
        for y0, y1 in ((.46,2.7),(2.7,5.2)):
            intact += [beam('Side brace',(sx*3.25,y0,-3.15),(sx*3.25,y1,1.75),.14,RUST_D),
                       beam('Side brace',(sx*3.25,y1,-3.15),(sx*3.25,y0,1.75),.14,RUST_D)]
    for y0, y1 in ((.46,2.7),(2.7,5.2),(5.2,6.8)):
        intact += [beam('Back brace',(-3.25,y0,-3.15),(3.25,y1,-3.15),.14,RUST_D),
                   beam('Back brace',(3.25,y0,-3.15),(-3.25,y1,-3.15),.14,RUST_D)]
    for y in (2.7,5.2):
        intact += [box('Catwalk',(6.1,.08,.7),(0,y,-2.75),IRON,.01),
                   beam('Handrail',(-3.0,y+.55,-2.4),(3.0,y+.55,-2.4),.05,HAZARD)]
        for sx in (-1,1):
            intact += [box('Catwalk',(.7,.08,4.4),(sx*2.85,y,-.7),IRON,.01),
                       beam('Handrail',(sx*2.5,y+.55,-2.4),(sx*2.5,y+.55,1.5),.05,HAZARD)]
            for z in (-2.4,-.5,1.5):
                intact.append(beam('Rail post',(sx*2.5,y,z),(sx*2.5,y+.55,z),.04,HAZARD))
    intact += [box('Gantry bridge',(6.92,.36,.4),(0,7.38,-.75),CRANE),
               box('Gantry trolley',(.95,.3,.8),(-.3,7.71,-.75),IRON),
               beam('Hoist cable',(-.55,7.2,-.75),(-.7,6.6,-.75),.04,DARK),
               beam('Hoist cable',(-.05,7.2,-.75),(.1,6.6,-.75),.04,DARK),
               box('Lifting beam',(1.6,.14,.2),(-.3,6.63,-.75),CRANE)]
    intact += hazard(-3.2,3.2,7.38,-.55,.2,'xy')
    # Jib arm on the front-right column swings a knee plate for the second leg.
    jx, jy, jz = 3.25, 6.35, 1.75
    intact += [cyl('Jib slewing ring',.32,.18,(jx,jy,jz),DARK,vertices=10),
               beam('Jib boom',(jx,jy+.15,jz),(1.0,jy+.15,.75),.2,CRANE),
               beam('Jib tie',(jx,jy+.75,jz),(1.4,jy+.2,.93),.06,DARK),
               cyl('Jib mast',.08,.6,(jx,jy+.45,jz),CRANE,vertices=8),
               beam('Jib cable',(1.1,jy+.05,.8),(1.1,4.95,.8),.03,DARK),
               tbox('Hanging knee plate',(1.0,1.0,.22),(1.1,4.45,.8),PRIMER,(-.2,.5,0),.05)]
    intact += jug_leg(-1.0) + jug_hip()
    # Parts for the second leg wait on a cradle.
    intact += [box('Parts cradle',(1.8,.45,1.0),(2.05,.5,.35),CRANE),
               xform(armor('Spare shin',1.1,.95,0,2.55,.3,(0,0),PRIMER),(0,0,-math.pi/2),(0,0,0),(.85,1.27,.35))]

    wreck = [box('Scaffold column',(.42,4.5,.42),(-3.25,2.71,-3.15),RUST),
             tbox('Torn column top',(.42,.5,.42),(-3.22,5.1,-3.15),RUST,(.3,.2,.45)),
             box('Scaffold column',(.42,2.6,.42),(3.25,1.76,-3.15),RUST),
             box('Scaffold column',(.42,1.3,.42),(-3.25,1.11,1.75),RUST),
             tbox('Column stub',(.42,.7,.42),(3.25,.8,1.75),RUST,(0,0,-.2)),
             tbox('Fallen column',(.42,4.1,.42),(1.2,.62,-2.2),RUST,(0,.55,math.pi/2)),
             tbox('Fallen column',(.42,4.4,.42),(-1.5,1.05,1.25),RUST,(.15,-.4,1.35)),
             tbox('Fallen column',(.42,3.2,.42),(2.6,.55,.6),RUST,(math.pi/2,.15,0)),
             tbox('Hanging catwalk',(6.0,.08,.7),(-.1,1.6,-2.75),DARK,(0,0,-.36),.01),
             tbox('Fallen catwalk',(.7,.08,4.2),(-2.75,.5,-.7),DARK,(.12,0,.3),.01),
             beam('Bent handrail',(-3.0,2.6,-2.45),(2.9,.45,-2.3),.05,HAZARD),
             tbox('Fallen girder',(6.0,.4,.36),(.2,.5,2.55),RUST_D,(0,-.12,.06)),
             beam('Hanging girder',(-3.25,4.8,-3.1),(-.8,.45,-1.6),.36,RUST_D),
             beam('Back brace',(-3.25,.46,-3.15),(1.0,1.9,-3.15),.14,RUST_D),
             beam('Back brace',(3.25,.46,-3.15),(1.5,2.2,-3.15),.14,RUST_D),
             beam('Fallen gantry',(-3.4,4.4,-2.6),(3.0,.5,.1),.34,CRANE),
             tbox('Gantry trolley',(.95,.3,.8),(3.1,.5,-.5),IRON,(.3,.6,.4))]
    # The leg toppled backwards from its foot; the hip frame crashed down behind it.
    leg = jug_leg(-1.0)
    discard(leg[9:])
    wreck += leg[:6]
    wreck += group(leg[6:9], (-1.33,.25,0), (-1.0,1.15,.15))
    wreck.append(xform(armor('Broken thigh',1.3,1.05,0,2.4,.3,(0,0),PRIMER),(0,.95,-1.45),(0,0,0),(1.8,1.0,-.9)))
    hip = jug_hip()
    discard(hip[4:])
    wreck += group(hip[:4], (.18,.35,-.12), (0,6.0,-.6), (1.0,-4.85,-1.7))
    wreck += [tbox('Parts cradle',(1.8,.45,1.0),(2.3,.5,1.0),CRANE,(0,.3,.25)),
              tbox('Knee plate',(1.0,1.0,.22),(-.4,.42,2.9),PRIMER,(1.3,.4,0),.05)]
    wreck += rubble(.2,-.6,2.4,18,41,(RUST_D,CONCRETE,GUNMETAL,PRIMER),.3,.3)
    wreck += [scorch(-.6,-.3,1.3,62,.3), scorch(2.2,-2.4,.7,63,.3)]
    return base, intact, wreck, lamp


# --- Zeppelin hangar: ribbed vault along X (front clamshell retracted), bomber airship, mooring mast, gas tank.
ZEP = dict(zc=-1.3, hw=2.35, h=3.85)
ZEP_RIBS = (-3.62,-2.42,-1.21,0,1.21,2.42,3.62)
MAST = (2.95, 2.75)


def zep_airship(ax, ay, az):
    parts = [ellipsoid('Airship envelope',(3.15,1.2,1.2),(ax,ay,az),CANVAS,18,10)]
    for dx in (-1.6,0,1.6):
        r = 1.2*math.sqrt(1-(dx/3.15)**2) + .015
        parts.append(xform(torus('Envelope frame',r,.045,(ax+dx,ay,az),SHEET),(0,0,math.pi/2),(ax+dx,ay,az)))
    parts.append(xform(cone('Nose cap',.35,.05,.3,(0,0,0),SHEET,10),(0,0,-math.pi/2),(0,0,0),(ax+3.05,ay,az)))
    for k in range(4):
        fin = prism('Tail fin',[(ax-3.35,.2),(ax-2.15,.35),(ax-2.8,1.25),(ax-3.4,1.2)],-.035,.035,'#8e876f','xy')
        parts.append(xform(fin,(math.pi/4+k*math.pi/2,0,0),(0,0,0),(0,ay,az)))
    parts += [armor('Gondola',2.0,.72,.6,.92,.16,(ax+.4,az),IRON),
              box('Gondola windows',(1.3,.12,.04),(ax+.6,.82,az+.33),GLASS,.005),
              box('Bomb bay',(.8,.06,.4),(ax+.1,.585,az),BLACK,.005)]
    for sz in (-1,1):
        parts += [pipe('Engine nacelle',(ax-1.0,1.5,az+sz*1.45),(ax-.25,1.5,az+sz*1.45),.18,IRON),
                  beam('Nacelle strut',(ax-.6,1.5,az+sz*1.3),(ax-.6,1.85,az+sz*.95),.07,DARK),
                  box('Propeller',(.04,.7,.1),(ax-1.05,1.5,az+sz*1.45),DARK,.01),
                  box('Propeller',(.04,.1,.7),(ax-1.05,1.5,az+sz*1.45),DARK,.01)]
    return parts


def zep_mast(x, z, y0=SLAB+.18, panels=None):
    parts = truss(x, z, y0, 5.85, .72, .26, 3, 5, .12, .06, RUST, IRON, panels, math.pi/2)
    if panels is None or 4 in panels:
        parts += [cyl('Mast platform',.5,.12,(x,5.9,z),DARK,vertices=10),
                  torus('Platform rail',.48,.025,(x,6.2,z),STEEL),
                  box('Mooring winch',(.3,.22,.3),(x+.15,6.07,z-.15),IRON,.02),
                  torus('Mooring ring',.38,.07,(x,6.4,z),CRANE,'z'),
                  cyl('Ring hub',.1,.18,(x,6.4,z),DARK,'z',8)]
    return parts


def zep_site():
    zc, hw, h = ZEP['zc'], ZEP['hw'], ZEP['h']
    base = tech_slab(5)
    base += [box('Hangar floor',(7.3,.03,4.75),(0,.255,zc),'#585a54',.01),
             box('Door track',(7.5,.06,.16),(0,.27,1.12),STEEL,.01),
             cyl('Mast footing',.95,.18,(MAST[0],.33,MAST[1]),CONCRETE_L,vertices=6),
             torus('Mooring circle',1.1,.035,(MAST[0]-.3,.25,MAST[1]-.1),HAZARD),
             box('Tank footing',(1.8,.12,1.8),(-2.3,.3,2.45),CONCRETE_L,.03)]
    base += hazard(-1.4,1.6,1.5,SLAB,.22)
    lamp_parts, lamp = beacon_post(-3.5, 3.5)
    base += lamp_parts

    intact = [arch('Hangar shell',-3.62,3.62,zc,hw,h,SLAB,.1,1.05,math.pi,SHEET),
              arch('Retracted door',-3.5,3.5,zc,hw+.1,h+.1,SLAB,.08,1.1,1.95,'#99a096'),
              box('Ridge vent',(6.8,.16,.45),(0,SLAB+h+.12,zc+.02),IRON,.02)]
    for x in ZEP_RIBS:
        intact.append(arch('Hangar rib',x-.1,x+.1,zc,hw+.16,h+.16,SLAB,.3,0,math.pi,IRON))
    for th in (1.35,1.65):
        intact.append(arch('Door seam',-3.5,3.5,zc,hw+.13,h+.13,SLAB,.05,th,th+.04,'#5d635b',1))
    wall = [(zc+hw*math.cos(t*math.pi/13), SLAB+h*math.sin(t*math.pi/13)) for t in range(14)]
    intact.append(prism('End wall',wall,-3.6,-3.48,SHEET,'zy'))
    intact += zep_airship(.2,2.05,zc)
    intact += zep_mast(*MAST)
    tx, tz = -2.3, 2.45
    intact += [ellipsoid('Gas tank',(.9,.9,.9),(tx,1.5,tz),'#b6b2a3',16,10),
               torus('Tank band',.91,.05,(tx,1.5,tz),HAZARD),
               cyl('Tank valve',.12,.25,(tx,2.45,tz),IRON,vertices=8),
               pipe('Gas line',(tx+.6,.55,tz-.5),(tx+1.0,.55,1.2),.08,STEEL)]
    for sx in (-1,1):
        for sz in (-1,1):
            intact.append(beam('Tank leg',(tx+sx*.62,.36,tz+sz*.62),(tx+sx*.45,1.1,tz+sz*.45),.09,IRON))

    wreck = [arch('Shell remnant',-3.62,-.6,zc,hw,h,SLAB,.1,2.15,math.pi,SHEET),
             arch('Shell remnant',-.6,1.21,zc,hw,h,SLAB,.1,2.6,math.pi,SHEET),
             prism('Broken end wall',[(zc+hw,SLAB),(zc+hw*math.cos(.5),SLAB+h*math.sin(.5)),(zc+.6,2.5),
                                      (zc-.3,2.0),(zc-hw*math.cos(.75),SLAB+h*math.sin(.75)),(zc-hw,SLAB)],-3.6,-3.48,SHEET,'zy')]
    for x, spans in zip(ZEP_RIBS, (((0,.5),(1.7,math.pi)), ((0,.8),(2.2,math.pi)), ((2.5,math.pi),),
                                   ((0,.45),(2.0,math.pi)), (), ((0,1.0),(2.4,math.pi)), ((0,1.3),))):
        for th0, th1 in spans:
            wreck.append(arch('Broken rib',x-.1,x+.1,zc,hw+.16,h+.16,SLAB,.3,th0,th1,IRON))
    wreck.append(xform(arch('Toppled rib',1.11,1.31,zc,hw+.16,h+.16,SLAB,.3,0,math.pi,IRON),(0,0,.75),(1.21,SLAB,zc)))
    panel = arch('Fallen panel',0,1.6,0,hw,h,0,.1,1.3,2.0,SHEET)
    wreck.append(xform(panel,(.0,.3,-.2),(0,0,0),(-2.6,-2.45,.2)))
    wreck += [tbox('Fallen panel',(1.5,.08,1.1),(2.6,.5,-.2),SHEET,(.3,.4,.25),.01),
              tbox('Fallen panel',(1.3,.08,1.0),(-1.6,.45,.6),SHEET,(-.25,-.3,.2),.01)]
    # Deflated envelope draped over the floor, tail fin and one frame ring still showing.
    env = ellipsoid('Deflated envelope',(3.0,.6,1.5),(.1,.68,zc),CANVAS,18,8)
    for v in env.data.vertices:
        x, up = v.co.x, v.co.z
        v.co.z = max(-.42, up + .16*math.sin(x*2.1)*math.cos(v.co.y*1.9) - (.2 if x > 1.2 else 0))
        v.co.y *= 1 + .12*math.sin(x*3.3)
    wreck.append(env)
    fin = prism('Tail fin',[(-3.0,.2),(-1.9,.35),(-2.5,1.25),(-3.05,1.2)],-.035,.035,'#8e876f','xy')
    wreck.append(xform(fin,(.45,.2,0),(0,0,0),(0,.75,zc)))
    wreck.append(xform(torus('Exposed frame',.95,.05,(0,0,0),SHEET),(0,0,math.pi/2-.35),(0,0,0),(1.2,.98,zc)))
    wreck.append(tbox('Crushed gondola',(2.0,.32,.7),(.9,.5,zc+1.3),IRON,(.2,.4,.25)))
    wreck.append(pipe('Engine nacelle',(-1.6,.42,zc-1.9),(-.9,.5,zc-1.6),.18,IRON))
    # Mooring mast snapped above its first storey and fell onto the ruins.
    wreck += zep_mast(*MAST, panels=[0])
    top = zep_mast(0, 0, panels=[1,2,3,4])
    wreck += group(top, (-1.28,.62,0), (0,1.5,0), (MAST[0],-.75,MAST[1]))
    # Gas tank split open.
    tx, tz = -2.3, 2.45
    shell = bowl('Ruptured tank', [(.9*math.sin(p), .9*(1-math.cos(p))) for p in (0,.45,.9,1.25)], '#9a978b', .05, 16, 5.2, .8)
    wreck.append(xform(shell,(.25,0,.15),(0,0,0),(tx,.45,tz)))
    for i in range(5):
        a = i*math.tau/5 + .4
        wreck.append(tbox('Tank petal',(.5,.55,.05),(tx+math.cos(a)*1.0,1.15,tz+math.sin(a)*1.0),'#8f8c80',(-1.0,math.pi/2-a,0),.01))
    wreck.append(tbox('Tank shard',(.7,.05,.6),(tx+.9,.3,tz+.3),'#9a978b',(.2,.8,.1),.01))
    for sx in (-1,1):
        wreck.append(beam('Tank leg',(tx+sx*.62,.36,tz+.62),(tx+sx*.45,1.1,tz+.45),.09,IRON))
    wreck += [scorch(tx,tz,1.1,70,.36), scorch(.4,.4,.9,71)]
    wreck += rubble(.5,-.8,2.6,12,51,(SHEET,IRON,CONCRETE),.26)
    return base, intact, wreck, lamp


TECH_SITES = {'silo': (silo_site, 5.0), 'ion': (ion_site, 8.5), 'mammoth': (mammoth_site, 6.0),
              'juggernaut': (jug_site, 8.0), 'zeppelin': (zep_site, 7.0)}


def check_fit(label, objs, height, half=3.95):
    # Report any part leaving the 4x4-cell footprint, sinking below the ground or above the site height.
    for obj in objs:
        pts = [obj.matrix_basis @ v.co for v in obj.data.vertices]
        lo = [min(p[i] for p in pts) for i in range(3)]
        hi = [max(p[i] for p in pts) for i in range(3)]
        if min(lo[0], lo[1]) < -half or max(hi[0], hi[1]) > half or lo[2] < -.03 or hi[2] > height:
            print(f'FIT {label}: {obj.name} x {lo[0]:.2f}..{hi[0]:.2f} y {lo[2]:.2f}..{hi[2]:.2f} z {-hi[1]:.2f}..{-lo[1]:.2f}')


def tech(kind):
    reset()
    build, height = TECH_SITES[kind]
    base, intact, wreck, lamp = build()
    for label, objs in (('base', base), ('intact', intact), ('wreck', wreck)):
        check_fit(f't_{kind} {label}', objs, height)
    merge('Site foundation', base)
    merge('Intact structure', intact, empty('intact',(0,0,0)))
    merge('Ruined structure', wreck, empty('wreck',(0,0,0)))
    beacon_lamp(*lamp)
    save('t_' + kind)


# ---------------------------------------------------------------- Mammoth super-tank
# Pre-war heavy tank either faction builds after capturing the Mammoth plant: the same weathered
# olive-grey hull for both, only the identification accents follow the owner (BLUE / RED).
HEAVY = '#5a5e52'
HEAVY_L = '#727565'
HEAVY_D = '#3b3e37'
HEAVY_T = '#666a5b'


def glacis(z):
    # Height of the hull's front slope at z (from the bow edge up to the deck).
    return .88 + (2.95 - z) * .585


def rod(name, r, pos, length, tint, axis='y', n=8):
    # Unbevelled n-gon cylinder: a cheaper cyl() for the many small round parts.
    pts = [(r*math.cos(i*math.tau/n), r*math.sin(i*math.tau/n)) for i in range(n)]
    x, y, z = pos
    if axis == 'y':
        return prism(name, [(x+u, z+v) for u,v in pts], y-length/2, y+length/2, tint, 'xz')
    if axis == 'x':
        return prism(name, [(z+u, y+v) for u,v in pts], x-length/2, x+length/2, tint, 'zy')
    return prism(name, [(x+u, y+v) for u,v in pts], z-length/2, z+length/2, tint, 'xy')


def mammoth(accent=BLUE):
    reset()
    hull = []
    track = [(-2.55,0),(2.55,0),(2.98,.38),(2.98,.62),(2.72,.96),(-2.72,.96),(-2.98,.62),(-2.98,.38)]
    for s in (-1,1):
        # Double track unit: two belts with a dark gap, under one armoured pod.
        for x0, x1 in ((1.05,1.56),(1.62,2.1)):
            hull.append(prism('Track belt', track, s*x0, s*x1, SOOT, 'zy', .05))
            for z, y in ((2.83,.8),(2.99,.5),(2.77,.17)):
                for sz in (-1,1):
                    hull.append(box('Track cleat',(x1-x0-.04,.07,.08),(s*(x0+x1)/2,y,sz*z),IRON,0))
        hull.append(prism('Track gap', [(z*.985,y*.97+.015) for z,y in track], s*1.56, s*1.62, BLACK, 'zy'))
        for z in (-2.05,-1.2,-.35,.5,1.35,2.2):
            hull += [rod('Road wheel',.31,(s*2.12,.37,z),.05,IRON,'x'),
                     rod('Wheel hub',.12,(s*2.15,.37,z),.04,HEAVY_D,'x',6)]
        for z in (2.62,-2.62):
            hull.append(rod('Sprocket hub',.25,(s*2.12,.55,z),.05,HEAVY_D,'x'))
        pod = [(-2.78,.72),(2.68,.72),(2.92,.92),(2.32,1.46),(-2.42,1.46),(-2.86,1.0)]
        hull.append(prism('Track pod', pod, s*1.0, s*2.1, HEAVY, 'zy', .05))
        # Bolted side skirts with gaps showing the road wheels underneath.
        for z0, z1 in ((-2.55,-1.3),(-1.24,.0),(.06,1.3),(1.36,2.5)):
            hull.append(box('Side skirt',(.08,.56,z1-z0),(s*2.13,.97,(z0+z1)/2),HEAVY_L,.025))
            for zb in (z0+.15, z1-.15):
                hull.append(box('Skirt bolt',(.04,.06,.06),(s*2.17,1.15,zb),HEAVY_D,0))
        for z in (-.62,.68):
            hull.append(box('Team band',(.05,.16,1.1),(s*2.17,.98,z),accent,.01))
        # Pod tops: faded hazard chevrons at the bow, lockers and a fuel drum at the stern.
        lo, hi = sorted((s*1.08, s*2.02))
        hull += hazard(lo, hi, 1.95, 1.46, .26)
        hull += [box('Stowage locker',(.75,.32,.9),(s*1.56,1.62,-1.5),HEAVY_L,.04),
                 box('Locker lid',(.79,.04,.94),(s*1.56,1.79,-1.5),HEAVY_D,.01),
                 rod('Fuel drum',.24,(s*1.56,1.7,-2.3),.85,RUST_D,'x',10),
                 box('Drum strap',(.06,.5,.18),(s*1.56,1.7,-2.3),SOOT,.01),
                 box('Headlight recess',(.34,.22,.12),(s*1.56,1.2,2.62),HEAVY_D,.03),
                 box('Headlight',(.24,.1,.04),(s*1.56,1.21,2.69),GLASS,.01),
                 box('Tow hook',(.16,.14,.2),(s*1.56,.8,2.92),SOOT,.03),
                 tbox('Rust streak',(.5,.02,.32),(s*1.6,1.465,.9),RUST,(0,.6*s,0),.005),
                 tbox('Rust streak',(.35,.02,.25),(s*1.45,1.465,-.5),RUST_D,(0,-.4*s,0),.005)]
    # Central hull with a steep glacis between the track pods.
    hull.append(armor('Lower chassis',2.1,5.5,.42,1.0,.1,(0,0),HEAVY_D))
    body = [(-2.8,.6),(2.62,.6),(2.95,.88),(1.72,1.6),(-2.55,1.6),(-2.86,1.3)]
    hull.append(prism('Upper hull', body, -1.02, 1.02, HEAVY, 'zy', .05))
    hull.append(box('Bow plate',(2.0,.36,.12),(0,.98,2.9),HEAVY_D,.03))
    hull += hazard(-.95,.95,.98,2.96,.22,'xy')
    pitch = math.atan(.585)
    hull.append(tbox('Glacis identification',(.72,.04,.44),(0,glacis(2.3)+.025,2.3),accent,(pitch,0,0),.01))
    for s in (-1,1):
        for z in (2.05,2.55):
            hull.append(tbox('Spare track link',(.42,.07,.2),(s*.62,glacis(z)+.035,z),SOOT,(pitch,0,0),.015))
    hull += [box('Driver hatch',(.6,.08,.46),(-.45,1.63,1.35),HEAVY_D,.03),
             box('Vision block',(.36,.09,.06),(-.45,1.66,1.6),GLASS,.005)]
    # Engine deck: grilles between two soot-blackened exhaust stacks.
    for x in (-.44,-.22,0,.22,.44):
        hull.append(box('Engine grille',(.14,.03,.36),(x,1.615,-2.38),SOOT,.005))
    for s in (-1,1):
        hull += [rod('Exhaust stack',.18,(s*.85,2.07,-2.4),.95,RUST,n=10),
                 rod('Stack band',.205,(s*.85,1.92,-2.4),.08,RUST_D,n=10),
                 rod('Stack cap',.21,(s*.85,2.52,-2.4),.12,SOOT,n=10),
                 rod('Stack mouth',.15,(s*.85,2.585,-2.4),.02,BLACK,n=10),
                 box('Stack bracket',(.42,.24,.34),(s*.85,1.72,-2.4),HEAVY_D,.03)]
    hull.append(box('Rear stencil',(.7,.18,.04),(0,1.0,-2.86),WHITE,.005))
    merge('Chassis',hull)

    zc = -.35
    t = empty('turret',(0,1.6,zc))
    b = empty('barrel',(0,.48,1.38),t)
    turret = [cyl('Turret race',1.08,.14,(0,1.66,zc),IRON,vertices=16),
              armor('Turret armor',2.5,2.75,1.72,2.48,.66,(0,zc-.12),HEAVY_T),
              box('Rear bustle',(1.5,.5,.55),(0,2.05,zc-1.55),HEAVY_D,.06),
              box('Mantlet',(1.62,.72,.42),(0,2.08,zc+1.2),HEAVY_L,.09),
              cyl('Commander cupola',.34,.2,(-.48,2.58,zc-.42),HEAVY_D,vertices=12),
              cyl('Cupola hatch',.27,.06,(-.48,2.71,zc-.42),HEAVY_L,vertices=12),
              box('Cupola optic',(.24,.12,.08),(-.48,2.62,zc-.06),GLASS,.005),
              box('Gunner sight',(.32,.22,.36),(.45,2.58,zc+.3),HEAVY_D,.03),
              box('Sight lens',(.24,.12,.02),(.45,2.6,zc+.485),GLASS,.005),
              box('Roof identification',(.8,.03,.46),(.3,2.495,zc-.7),accent,.01),
              tbox('Turret scrape',(.6,.02,.18),(-.2,2.49,zc+.3),RUST_D,(0,.5,0),.005),
              beam('Antenna',(.72,2.48,zc-1.1),(.78,3.15,zc-1.18),.035,SOOT),
              cyl('Antenna base',.08,.08,(.72,2.52,zc-1.1),HEAVY_D,vertices=8)]
    pz = zc-.05
    for s in (-1,1):
        # Side-mounted missile pods on short pylons, 2x2 tubes facing forward.
        turret += [box('Pod pylon',(.4,.24,.7),(s*1.3,2.06,pz),HEAVY_D,.03),
                   box('Missile pod',(.62,.66,1.4),(s*1.66,2.2,pz),HEAVY_L,.06),
                   box('Pod face',(.56,.6,.04),(s*1.66,2.2,pz+.71),HEAVY_D,.01),
                   box('Pod team band',(.64,.12,.3),(s*1.66,2.555,pz-.4),accent,.01),
                   box('Pod team band',(.04,.14,.9),(s*1.975,2.3,pz-.1),accent,.01),
                   box('Smoke discharger',(.22,.16,.3),(s*1.0,2.3,zc+.95),HEAVY_D,.02)]
        for dx in (-.14,.14):
            for dy in (-.15,.15):
                p = (s*1.66+dx,2.2+dy,pz+.75)
                turret += [rod('Missile tube',.1,(p[0],p[1],pz+.73),.06,SOOT,'z',6),
                           xform(cone('Missile nose',.07,.0,.12,p,WHITE,8),(math.pi/2,0,0),p)]
    merge('Turret armor',turret,t)
    gy, gz = 2.08, zc+1.38
    guns = [box('Gun yoke',(.66,.16,.26),(0,gy,gz+.5),HEAVY_D,.03)]
    for x in (-.42,.42):
        guns += [rod('Gun sleeve',.21,(x,gy,gz+.28),.6,HEAVY,'z',12),
                 rod('Gun tube',.12,(x,gy,gz+1.35),1.62,IRON,'z',12),
                 rod('Fume extractor',.17,(x,gy,gz+1.12),.34,HEAVY_D,'z',12),
                 box('Muzzle brake',(.32,.28,.36),(x,gy,gz+2.29),SOOT,.035),
                 box('Bore',(.14,.11,.012),(x,gy,gz+2.476),'#080d10',.006)]
    merge('Twin cannon',guns,b)
    for i, x in enumerate((-.42,.42)):
        empty(f'muzzle_{i}',(x,0,2.48),b)
    empty('muzzle',(-.42,0,2.48),b)
    save('m_mammoth' if accent == RED else 'h_mammoth')


# ---------------------------------------------------------------- Juggernaut walker
# Pre-war bipedal artillery walker assembled in the captured Juggernaut plant: the plant's
# knee-forward legs and hip frame under a rotating gun deck with a triple battery. Same
# weathered hull for both factions; only the identification accents follow the owner.
JUG_HIP = 2.75      # hip axis height above the ground
JUG_LEGX = 1.3      # hip joints at x = +-JUG_LEGX
JUG_ELEV = .07      # the battery sits slightly elevated (baked into the mesh; `barrel` stays unrotated)
JUG_GUNS = (-.56, 0, .56)
JUG_DECK = .27      # gun deck parts are authored for a 2.95 race and lifted by this much


def jug_sole(z):
    # Rocker sole: an arc around the hip axis, so a swinging foot rolls instead of digging in.
    return JUG_HIP - math.sqrt(JUG_HIP**2 - z*z) + .004


def walker_leg(i, accent):
    s = -1 if i == 0 else 1
    lx, h = s*JUG_LEGX, JUG_HIP
    ax, ay, az = lx, .58, .02       # ankle
    ky, kz = 1.6, .52               # knee
    pivot = empty(f'leg_{i}', (lx, h, 0))
    arc = lambda z0, z1, n: [(z0 + (z1-z0)*k/n, jug_sole(z0 + (z1-z0)*k/n)) for k in range(n+1)]
    foot = arc(-.62, .5, 4) + [(.5,.4),(.22,.6),(-.3,.6),(-.62,.36)]
    parts = [prism('Mech foot', foot, lx-.4, lx+.4, HEAVY_T, 'zy', .03)]
    for dx, tip in ((-.27,.95),(0,1.06),(.27,.95)):
        toe = arc(.42, tip, 3) + [(tip, jug_sole(tip)+.1), (tip-.22,.34), (.42,.44)]
        parts.append(prism('Toe claw', toe, lx+dx-.115, lx+dx+.115, GUNMETAL, 'zy', .02))
    parts.append(prism('Heel spur', arc(-.88,-.55,2) + [(-.55,.34),(-.88,.26)], lx-.15, lx+.15, GUNMETAL, 'zy', .02))
    parts += [rod('Ankle joint',.24,(ax,ay,az),.64,DARK,'x',12),
              box('Ankle cheek',(.08,.42,.5),(lx-.33,ay+.02,az),GUNMETAL,.02),
              box('Ankle cheek',(.08,.42,.5),(lx+.33,ay+.02,az),GUNMETAL,.02)]
    # Shin and thigh: tapered armour boxes along the bones, knee pushed forward like the plant's leg.
    shin = math.atan2(kz-az, ky-ay)
    parts.append(xform(armor('Mech shin',.46,.42,0,math.hypot(kz-az,ky-ay),.12,(0,0),HEAVY_T),(shin,0,0),(0,0,0),(ax,ay,az)))
    thigh = math.atan2(0-kz, h-ky)
    parts.append(xform(armor('Mech thigh',.54,.5,0,math.hypot(kz,h-ky),.12,(0,0),HEAVY),(thigh,0,0),(0,0,0),(lx,ky,kz)))
    parts += [rod('Knee joint',.26,(lx,ky,kz),.58,DARK,'x',12),
              rod('Knee hub',.15,(lx+s*.31,ky,kz),.06,HEAVY_D,'x',8),
              tbox('Knee guard',(.52,.5,.16),(lx,ky+.04,kz+.26),HEAVY_L,(-.32,0,0),.04),
              rod('Hip drum',.36,(lx,h,0),.46,GUNMETAL,'x',14),
              rod('Hip hub',.2,(lx+s*.25,h,0),.06,DARK,'x',10),
              tbox('Thigh identification',(.04,.3,.42),(lx+s*.265,(ky+h)/2,kz/2),accent,(thigh,0,0),.008),
              tbox('Shin plate',(.36,.4,.05),(lx,(ay+ky)/2,(az+kz)/2+.22),PRIMER,(shin,0,0),.015)]
    # Exposed hydraulics: a ram on each side of the shin and the thigh (dark cylinder, steel rod).
    for dx in (-.31,.31):
        for a, b in (((lx+dx,.86,-.14),(lx+dx,1.45,.27)), ((lx+dx,1.86,.42),(lx+dx,2.5,-.25))):
            m = tuple((p+q)/2 for p,q in zip(a,b))
            parts += [pipe('Ram cylinder',a,m,.07,DARK,8), pipe('Ram rod',m,b,.04,STEEL,6)]
    parts += [pipe('Calf ram',(lx,.5,-.36),(lx,1.0,-.12),.08,DARK,8),
              pipe('Calf rod',(lx,1.0,-.12),(lx,1.42,.1),.045,STEEL,6)]
    parts.append(beam('Hydraulic hose',(lx-s*.2,2.35,-.32),(lx-s*.2,1.65,-.1),.05,SOOT,0))
    merge('Leg armor', parts, pivot)
    return pivot


def jug_turret(accent):
    # Gun deck on a race above the pelvis: open frame, chin cockpit, ammo drums, reactor pack.
    parts = [rod('Turret race',.64,(0,3.0,0),.1,IRON,'y',16),
             armor('Deck hull',1.9,2.1,3.05,3.62,.3,(0,-.25),HEAVY),
             box('Deck plate',(2.2,.1,2.5),(0,3.68,-.2),HEAVY_D,.025),
             prism('Cockpit',[(.7,3.1),(1.32,3.1),(1.58,3.32),(1.48,3.6),(.7,3.6)],-.55,.55,HEAVY_L,'zy',.035),
             tbox('Cockpit window',(.86,.18,.04),(0,3.46,1.555),GLASS,(-.33,0,0),.006),
             box('Cockpit brow',(1.14,.08,.22),(0,3.63,1.42),HEAVY_D,.02)]
    for x in (-.58,.58):
        parts.append(box('Cockpit side window',(.04,.14,.3),(x,3.42,1.1),GLASS,.005))
    # Exposed struts carry the deck overhang.
    for sx in (-1,1):
        for z in (-1.25,-.25,.75):
            parts.append(beam('Deck strut',(sx*.72,3.12,z),(sx*1.02,3.63,z),.09,GUNMETAL,0))
        parts += [beam('Deck stringer',(sx*1.02,3.6,-1.38),(sx*1.02,3.6,.98),.08,GUNMETAL,0),
                  box('Deck identification',(.04,.17,1.3),(sx*1.115,3.68,-.45),accent,.008)]
    # Gun cradle: wide base, two cheek plates and the trunnion axle.
    parts += [box('Gun cradle',(1.7,.26,.95),(0,3.86,.12),GUNMETAL,.03),
              rod('Trunnion axle',.13,(0,3.98,.35),2.0,DARK,'x',10)]
    for sx in (-1,1):
        parts += [box('Cradle cheek',(.12,.5,.85),(sx*.93,3.98,.3),HEAVY_L,.03),
                  box('Cheek identification',(.03,.14,.5),(sx*1.0,4.06,.3),accent,.006)]
    parts += hazard(-1.05,1.05,.9,3.73,.2)
    # Ammo drums on the deck shoulders feeding the breeches.
    for sx in (-1,1):
        parts += [rod('Ammo drum',.26,(sx*.84,4.0,-.85),.5,RUST_D,'x',12),
                  rod('Drum band',.27,(sx*.84,4.0,-.85),.08,HAZARD,'x',12),
                  rod('Drum cap',.14,(sx*(.84+.26),4.0,-.85),.04,SOOT,'x',8),
                  box('Drum cradle',(.46,.16,.46),(sx*.84,3.79,-.85),GUNMETAL,.02),
                  beam('Feed chute',(sx*.74,4.02,-.62),(sx*.56,3.98,-.3),.12,SOOT,.01)]
    # Reactor pack at the back: grilles and two short exhaust stacks.
    parts += [box('Reactor pack',(1.2,.5,.75),(0,3.98,-1.12),HEAVY_T,.04),
              box('Rear stencil',(.6,.14,.03),(0,3.95,-1.51),WHITE,.004)]
    for x in (-.36,-.18,0,.18,.36):
        parts.append(box('Vent grille',(.11,.03,.5),(x,4.24,-1.1),SOOT,.004))
    for sx in (-1,1):
        parts += [rod('Exhaust stack',.1,(sx*.42,4.02,-1.48),.5,RUST,'y',10),
                  rod('Stack cap',.13,(sx*.42,4.27,-1.48),.06,SOOT,'y',10)]
    # Rangefinder pod on the left front, radio mast on the right rear.
    parts += [box('Rangefinder',(.3,.28,.42),(-.92,3.87,.95),HEAVY_D,.03),
              box('Rangefinder lens',(.2,.13,.02),(-.92,3.89,1.165),GLASS,.004),
              beam('Antenna',(.92,3.72,-1.3),(.97,4.33,-1.35),.035,SOOT),
              rod('Antenna base',.08,(.92,3.78,-1.3),.1,HEAVY_D,'y',8),
              tbox('Deck scrape',(.5,.02,.16),(.75,3.735,.55),RUST_D,(0,.5,0),.004),
              tbox('Rust streak',(.4,.02,.22),(-.6,3.735,-.1),RUST,(0,-.4,0),.004)]
    return group(parts, move=(0,JUG_DECK,0))


def jug_guns():
    # Three long tubes side by side, merged as one battery mesh on the `barrel` pivot.
    y, z = 3.98, .35
    parts = [box('Barrel clamp',(1.38,.1,.18),(0,y,1.3),DARK,.02),
             box('Barrel clamp',(1.3,.08,.14),(0,y,2.25),DARK,.015)]
    for x in JUG_GUNS:
        parts += [box('Breech',(.3,.32,.7),(x,y,-.06),HEAVY_D,.03),
                  rod('Recoil sleeve',.17,(x,y,.6),.7,HEAVY,'z',12),
                  rod('Gun tube',.1,(x,y,1.9),1.96,IRON,'z',10),
                  rod('Fume extractor',.145,(x,y,1.72),.36,HEAVY_D,'z',10),
                  box('Muzzle brake',(.27,.25,.34),(x,y,2.95),SOOT,.03),
                  box('Bore',(.12,.1,.012),(x,y,3.123),'#080d10',.004)]
    return group(parts, (-JUG_ELEV,0,0), (0,y,z), (0,JUG_DECK,0))


def juggernaut(accent=BLUE):
    reset()
    for i in (0,1):
        walker_leg(i, accent)
    body = empty('body',(0,0,0))
    h = JUG_HIP
    pelvis = [armor('Pelvis',1.5,1.15,2.3,3.1,.25,(0,-.05),HEAVY_D),
              rod('Hip axle',.2,(0,h,0),2.1,DARK,'x',12),
              box('Pelvis front plate',(1.15,.42,.1),(0,2.63,.56),HEAVY_L,.02),
              box('Crotch armor',(.75,.24,.75),(0,2.23,-.05),SOOT,.03),
              box('Hydraulic pump',(.8,.4,.35),(0,2.6,-.72),GUNMETAL,.03),
              rod('Neck bearing',.5,(0,3.16,0),.12,DARK,'y',16)]
    pelvis += hazard(-.52,.52,2.63,.61,.22,'xy')
    for sx in (-1,1):
        pelvis += [box('Hip housing',(.32,.8,.8),(sx*.9,h,0),HEAVY,.04),
                   pipe('Hip hose',(sx*.35,2.45,-.9),(sx*.9,2.35,-.35),.045,SOOT,6)]
    merge('Pelvis', pelvis, body)
    t = empty('turret',(0,2.95+JUG_DECK,0),body)
    b = empty('barrel',(0,1.03,.35),t)
    merge('Gun deck', jug_turret(accent), t)
    merge('Triple battery', jug_guns(), b)
    L = 2.78
    tip = (L*math.sin(JUG_ELEV), L*math.cos(JUG_ELEV))
    for i, x in enumerate(JUG_GUNS):
        empty(f'muzzle_{i}',(x,tip[0],tip[1]),b)
    empty('muzzle',(JUG_GUNS[0],tip[0],tip[1]),b)
    save('m_juggernaut' if accent == RED else 'h_juggernaut')


BUILDERS = {
    'h_tank': tank, 'h_factory': factory,
    'h_rifle': lambda: infantry(), 'h_rocket': lambda: infantry(heavy=True),
    'm_sentinel': lambda: infantry(machine=True), 'h_arty': artillery,
    'h_harv': lambda: harvester(), 'm_harv': lambda: harvester(True),
    'h_medic': lambda: infantry(medic=True), 'h_mech': repair_truck,
    'm_nanite': nanite, 'm_welder': welder,
    'm_drone': drone, 'm_crusher': lambda: spider(), 'm_siege': lambda: spider(True),
    'h_turret': lambda: turret_building(), 'm_turret': lambda: turret_building(True),
    'h_hq': human_hq, 'm_hq': machine_hq,
    'h_power': lambda: power(), 'm_power': lambda: power(True),
    'h_refinery': lambda: refinery(), 'm_refinery': lambda: refinery(True),
    'h_barracks': lambda: barracks(), 'm_barracks': lambda: barracks(True),
    'm_factory': machine_factory, 'environment': environment, 'quarry': quarry,
    'prop_cash_crate': cash_crate,
    'h_engineer': lambda: infantry(engineer=True), 'm_engineer': machine_engineer,
    't_silo': lambda: tech('silo'), 't_ion': lambda: tech('ion'), 't_mammoth': lambda: tech('mammoth'),
    't_juggernaut': lambda: tech('juggernaut'), 't_zeppelin': lambda: tech('zeppelin'),
    'h_mammoth': lambda: mammoth(BLUE), 'm_mammoth': lambda: mammoth(RED),
    'h_juggernaut': lambda: juggernaut(BLUE), 'm_juggernaut': lambda: juggernaut(RED),
}
if __name__ == '__main__':
    requested = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(BUILDERS)
    for id in requested:
        BUILDERS[id]()
