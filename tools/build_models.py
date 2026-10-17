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
TIBERO = '#78de48'
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
PRIMER = '#a39a84'
GUNMETAL = '#555b57'
SHEET = '#868d83'
VEST = '#e98a2b'
DEEP = '#0b0f15'      # unlit recesses: intake pits, bucket mouths, bay interiors


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
    if tint in (RED, ORANGE, TEAL, TIBERO):
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


def armor(name, width, length, bottom, top, inset, center, tint, bevel=.025):
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
    return finish(obj, tint, bevel)


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


def harvester():
    # h_harv: wheeled ore truck with an open cargo bin (m_harv is the bucket-wheel excavator further down).
    reset()
    hull, edge, base, accent = OLIVE, LIGHT, DARK, BLUE
    objects = [box('Chassis',(2,.37,3.4),(0,.68,0),DARK,.07)]
    for s in (-1,1):
        for z in (-1.15,0,1.15):
            objects += [cyl('Tire',.46,.38,(s*.99,.46,z),DARK,'x'),
                        cyl('Hub',.23,.025,(s*1.19,.46,z),STEEL,'x')]
    objects += [armor('Cab',1.72,1.2,.83,1.86,.35,(0,1.04),hull),
                box('Windscreen',(1.3,.32,.07),(0,1.53,1.57),GLASS),
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
    save('h_harv')


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
    if machine:
        return machine_power()
    reset()
    objects = platform()
    objects += human_power_geometry()
    merge('Power plant',objects)
    save('h_power')


def disc_shell(name, r0, r1, a0, a1, z0, z1, tint, segs=8):
    # Faceted band around the Z axis between angles a0..a1 (0 = +X, pi/2 = up), z0..z1 deep.
    verts = []
    for k in range(segs+1):
        a = a0 + (a1-a0)*k/segs
        for r in (r1, r0):
            verts += [(math.cos(a)*r, math.sin(a)*r, z0), (math.cos(a)*r, math.sin(a)*r, z1)]
    faces = []
    for k in range(segs):
        o, n = 4*k, 4*k+4
        faces += [(o,n,n+1,o+1), (o+2,o+3,n+3,n+2), (o,o+2,n+2,n), (o+1,n+1,n+3,o+3)]
    e = 4*segs
    faces += [(0,1,3,2), (e,e+2,e+3,e+1)]
    return solid(name, verts, faces, tint)


POWER_DISC = (-.25, 2.4, -.05)   # generator hub, game space
POWER_YAW = -.5                  # the generator face turns towards the front-left


def power_local(objs):
    # Generator parts are authored around the hub with the face looking down +Z.
    return group(objs, (0,POWER_YAW,0), (0,0,0), POWER_DISC)


def power_rotor():
    rotor = empty('rotor', POWER_DISC)
    rotor.rotation_euler[2] = POWER_YAW
    objects = [cyl('Rotor disc',1.92,.46,(0,0,-.03),BLACK,'z',20),
               cyl('Rotor hub',.68,.62,(0,0,.1),MACHINE,'z',12),
               cyl('Hub face',.42,.1,(0,0,.44),MPLATE,'z',12),
               cyl('Axle',.2,1.0,(0,0,.85),MPLATE,'z',8)]
    for k in range(24):
        a = k*math.tau/24
        objects.append(tbox('Field vane',(.98,.1,.2),(math.cos(a)*1.3,math.sin(a)*1.3,.26),RED,(0,0,a),0))
    for k in range(12):
        a = (k+.5)*math.tau/12
        objects.append(tbox('Hub fin',(.22,.07,.16),(math.cos(a)*.62,math.sin(a)*.62,.38),BLACK,(0,0,a),0))
    merge('Generator rotor', power_local(objects), rotor)


def machine_power():
    reset()
    cx, cy, cz = POWER_DISC
    objects = platform(machine=True)
    objects += [armor('Generator plinth',5.4,5.4,.28,.62,.35,(0,0),MACHINE)]
    disc = [torus('Stator ring',2.03,.15,(0,0,0),MPLATE,'z'),
            cyl('Stator back',2.05,.3,(0,0,-.4),MACHINE,'z',20),
            # Armored hood arching over the top and back of the generator.
            disc_shell('Generator hood',2.22,2.55,-.55,2.75,-.95,.38,MPLATE,10),
            disc_shell('Hood lip',2.18,2.62,-.2,2.55,.38,.58,MACHINE,9),
            disc_shell('Hood stripe',2.55,2.58,.1,2.4,-.45,-.25,RED,8),
            disc_shell('Hood spine',2.55,2.68,1.2,1.6,-.95,.38,MACHINE,2),
            # Bearing pedestal holds the axle in front of the hub.
            cyl('Bearing',.36,.42,(0,0,1.25),MACHINE,'z',10),
            torus('Bearing glow',.36,.05,(0,0,1.47),RED,'z'),
            box('Bearing pedestal',(.62,cy-.6,.5),(0,-(cy-.6)/2,1.25),MACHINE),
            tbox('Pedestal brace',(.5,1.5,.3),(0,-1.3,.8),BLACK,(.55,0,0)),
            # Motor housing behind the generator.
            box('Exciter housing',(2.0,1.3,.9),(0,-1.1,-1.15),MACHINE),
            box('Exciter roof',(1.7,.08,.7),(0,-.42,-1.15),BLACK)]
    for a in (1.25,1.6):
        tip = (math.cos(a)*2.62, math.sin(a)*2.62, 1.5)
        disc += [beam('Hood antenna',(math.cos(a)*2.5,math.sin(a)*2.5,.4),tip,.07,BLACK),
                 cyl('Antenna tip',.06,.12,tip,RED,'y',6)]
    for x in (-.6,-.2,.2,.6):
        disc.append(box('Exciter vent',(.22,.6,.04),(x,-1.15,-.68),RED,.005))
    objects += power_local(disc)
    # Sloped feet where the hood meets the plinth, like buttressed pylons.
    def world(x, y, z):
        c, s_ = math.cos(POWER_YAW), math.sin(POWER_YAW)
        return (cx + x*c + z*s_, cy + y, cz - x*s_ + z*c)
    for a, z in ((-.55,-.3), (2.75,-.3)):
        fx, fy, fz = world(math.cos(a)*2.45, math.sin(a)*2.45, z)
        objects += [armor('Hood pylon',1.15,1.25,.6,fy,.75,(fx,fz),MPLATE),
                    armor('Pylon foot',1.4,1.5,.28,.75,.3,(fx,fz),BLACK)]
    # Exhaust tower at the back corner.
    sx, sz = 2.05, -2.05
    objects += [armor('Stack base',1.3,1.3,.6,1.2,.35,(sx,sz),MACHINE),
                cone('Exhaust tower',.46,.32,3.4,(sx,2.9,sz),MPLATE,10),
                cyl('Stack collar',.42,.14,(sx,4.0,sz),BLACK,10),
                torus('Stack glow',.39,.05,(sx,4.25,sz),RED),
                cyl('Stack crown',.38,.35,(sx,4.75,sz),MACHINE,10),
                cyl('Stack mouth',.27,.02,(sx,4.93,sz),BLACK,10)]
    for k in range(4):
        a = k*math.pi/2 + .4
        objects.append(tbox('Stack slot',(.08,.42,.03),(sx+math.cos(a)*.34,4.52,sz-math.sin(a)*.34),BLACK,(0,a,0),0))
    objects += [pipe('Exhaust duct',(sx-.3,1.0,sz+.5),(.4,1.0,-1.9),.14,BLACK),
                pipe('Coolant main',(-2.45,.78,-2.3),(-2.45,.78,1.5),.12,BLACK),
                pipe('Coolant riser',(-2.45,.78,-1.2),(-1.6,1.6,-1.2),.09,MPLATE),
                box('Transformer',(.9,.9,.8),(2.1,1.05,1.8),BLACK),
                box('Transformer light',(.5,.05,.03),(2.1,1.3,2.215),RED,.005)]
    # Drive motor on the open front corner.
    objects += [armor('Motor bed',1.5,1.2,.6,1.0,.25,(-1.95,1.95),BLACK),
                cyl('Drive motor',.36,1.0,(-1.95,1.35,1.95),MACHINE,'x',10),
                cyl('Motor band',.39,.08,(-1.6,1.35,1.95),RED,'x',10),
                cyl('Motor cap',.26,.12,(-2.5,1.35,1.95),MPLATE,'x',10)]
    for x in (1.85,2.35):
        objects += [cyl('Insulator',.07,.45,(x,1.72,1.8),MPLATE,8),
                    cyl('Insulator tip',.09,.07,(x,1.97,1.8),RED,8)]
    merge('Generator works',objects)
    power_rotor()
    save('m_power')


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


def canopy_panel(name, a0, a1, r0, y0, r1, y1, cx, cz, tint, t=.06):
    # Sloped canopy panel between angles a0..a1 (0 = +X, pi/2 = +Z), from (r0, y0) out to (r1, y1).
    P = lambda a, r, y: (cx + math.cos(a)*r, y, cz + math.sin(a)*r)
    top = [P(a0, r0, y0), P(a1, r0, y0), P(a1, r1, y1), P(a0, r1, y1)]
    bot = [(x, y - t, z) for x, y, z in top]
    faces = [(0,1,2,3), (7,6,5,4), (0,4,5,1), (1,5,6,2), (2,6,7,3), (3,7,4,0)]
    return solid(name, top + bot, faces, tint)


def machine_refinery():
    # Smelter after the Tiberian Sun Nod refinery: a conical canopy of plates between glowing red
    # ribs under a round deck carrying the refining towers. The canopy opens at the front onto a
    # docking bay; a striped ramp runs down from it to the pad where the harvesters unload.
    reset()
    o = platform(machine=True)
    top = .28
    cx, cz = -.2, -.3
    R0, R1, RM = 1.45, 2.5, 2.08        # deck edge, canopy foot, plate colour break
    Y0, Y1 = 1.62, top + .04
    ym = Y0 + (Y1 - Y0) * (RM - R0) / (R1 - R0)
    front, gap, n = math.pi/2, math.radians(34), 14    # bay opening centred on +Z, half-width gap
    angle = lambda i: front + gap + i * (math.tau - 2*gap) / n
    for i in range(n):
        a0, a1 = angle(i) + .012, angle(i+1) - .012
        o += [canopy_panel('Canopy plate', a0, a1, R0, Y0, RM, ym, cx, cz, MPLATE),
              canopy_panel('Canopy skirt', a0, a1, RM, ym, R1, Y1, cx, cz, MACHINE)]
    for i in range(n+1):
        a = angle(i)
        P = lambda r, y: (cx + math.cos(a)*r, y, cz + math.sin(a)*r)
        o += [beam('Canopy rib', P(R0-.05, Y0+.06), P(R1+.08, Y1-.02), .11, RED, 0),
              box('Rib foot', (.2,.14,.2), P(R1+.08, top+.07), BLACK, .01)]
        if i % 2 == 0:
            o.append(gem('Rib light', (.05,.04,.05), P(R0+.05, Y0+.12), RED))
    # Deck: dark disc with a red rim and a ring of grates round the towers.
    o += [rod('Deck', R0+.05, (cx,Y0+.04,cz), .14, BLACK, 'y', 28),
          torus('Deck rim', R0+.06, .05, (cx,Y0+.11,cz), RED),
          rod('Deck core', .9, (cx,Y0+.13,cz), .04, MACHINE, 'y', 20)]
    for k in range(10):
        a = k*math.tau/10
        o.append(tbox('Deck grate', (.6,.02,.05), (cx+math.cos(a)*1.15, Y0+.12, cz+math.sin(a)*1.15), BLACK, (0,-a,0), 0))
    # Docking bay: dark interior under the deck between two cheeks.
    o += [box('Bay interior', (2.2,1.1,.1), (cx,top+.55,cz+.55), DEEP, 0),
          box('Bay roof', (2.0,.1,1.0), (cx,Y0-.1,cz+.75), DEEP, 0)]
    for s in (-1,1):
        bx, bz = cx + math.cos(front+s*gap)*R1, cz + math.sin(front+s*gap)*R1
        o.append(prism('Bay cheek', [(cz+.4,top),(bz+.05,top),(cz+.95,Y0-.05),(cz+.4,Y0-.05)], bx-.07, bx+.07, MACHINE, 'zy', .01))
    # Ramp from the bay down to the pad, with red hazard bars.
    rz0, rz1, rw = cz+1.0, 2.55, 1.9
    ramp = lambda z: top+.32 + (z-rz0)/(rz1-rz0)*(.06-.32)
    o.append(prism('Intake ramp', [(rz0,top+.32),(rz1,top+.06),(rz1,top),(rz0,top)], cx-rw/2, cx+rw/2, BLACK, 'zy'))
    for i in range(5):
        z0, z1 = rz0 + (rz1-rz0)*(i+.2)/5, rz0 + (rz1-rz0)*(i+.7)/5
        o.append(prism('Hazard bar', [(z0,ramp(z0)+.005),(z1,ramp(z1)+.005),(z1,ramp(z1)+.02),(z0,ramp(z0)+.02)],
                       cx-rw/2+.12, cx+rw/2-.12, RED, 'zy'))
    # Octagonal docking pad along the front edge of the lot.
    o += [armor('Docking pad', 4.4, 1.9, top, top+.05, .1, (.1,1.98), '#30373f', .01),
          armor('Pad edge', 4.6, 2.05, top-.01, top+.03, .05, (.1,1.96), MPLATE, 0)]
    for s in (-1,1):
        o.append(gem('Pad light', (.06,.04,.06), (cx+s*1.15, top+.08, 2.75), RED))
    # Refining towers: a tall banded column on a flared base with a flare stack, two shorter stills
    # and a cluster of vent pipes.
    tx, tz = cx-.55, cz-.55
    o += [cone('Column base', .5, .24, .9, (tx,Y0+.55,tz), MACHINE, 12),
          rod('Column', .2, (tx,3.15,tz), 3.0, MPLATE, 'y', 12),
          cone('Column cap', .23, .08, .3, (tx,4.5,tz), MPLATE, 12),
          rod('Flare pipe', .06, (tx+.32,3.6,tz-.1), 1.7, BLACK, 'y', 6),
          gem('Flare', (.08,.1,.08), (tx+.32,4.5,tz-.1), ORANGE)]
    for y in (2.6, 3.25, 3.85):
        o.append(rod('Column ring', .3, (tx,y,tz), .1, BLACK, 'y', 12))
    for sx, sz, h in ((cx+.45,cz-.6,3.6), (cx+.1,cz+.35,3.05)):
        o += [rod('Still', .17, (sx,(Y0+h)/2,sz), h-Y0, MPLATE, 'y', 10),
              cone('Still cap', .19, .06, .22, (sx,h+.1,sz), MPLATE, 10),
              rod('Still ring', .26, (sx,h-.45,sz), .09, BLACK, 'y', 10),
              rod('Still ring', .24, (sx,h-.95,sz), .08, BLACK, 'y', 10),
              rod('Still footing', .28, (sx,Y0+.2,sz), .2, MACHINE, 'y', 10)]
    for k in range(4):
        o.append(rod('Vent pipe', .05, (cx-1.2+k*.12, Y0+.35, cz+.2-k*.08), .55+.12*(k % 2), MPLATE, 'y', 6))
    # Storage behind the canopy: a domed tank at the back right and a capsule on saddles at the back left.
    dx, dz = 2.15, -2.15
    o += [rod('Tank skirt', .78, (dx,top+.3,dz), .6, MACHINE, 'y', 16),
          rod('Storage tank', .72, (dx,.95,dz), .8, MACHINE, 'y', 16),
          gem('Tank dome', (.72,.45,.72), (dx,1.35,dz), MACHINE),
          rod('Tank cap', .3, (dx,1.78,dz), .1, MPLATE, 'y', 12),
          torus('Tank band', .73, .04, (dx,1.2,dz), RED),
          rod('Capsule', .5, (-2.0,1.1,-2.35), 1.4, MACHINE, 'x', 14),
          gem('Capsule end', (.25,.5,.5), (-1.3,1.1,-2.35), MACHINE),
          gem('Capsule end', (.25,.5,.5), (-2.7,1.1,-2.35), MACHINE)]
    for x in (-2.5,-1.5):
        o.append(box('Capsule saddle', (.18,.6,.9), (x,top+.3,-2.35), BLACK, .01))
    o += [pipe('Transfer pipe', (dx-.5,1.0,dz+.4), (cx+1.6,1.0,cz-.6), .1, BLACK),
          pipe('Transfer pipe', (-1.6,1.5,-2.2), (tx,1.9,tz), .08, BLACK)]
    merge('Refinery', o)
    save('m_refinery')


def refinery(machine=False):
    return machine_refinery() if machine else human_refinery()


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


def hq_eye(x, y, z, r=.9):
    # The Eye: a red ellipsoid with an orange iris and a black slit pupil. It is the `crystal` node,
    # so it turns round and round, sweeping the battlefield, inside a ring of flame spikes (`ring`).
    crystal = empty('crystal', (x, y, z))
    merge('Eye', [gem('Eye', (.42,.6,.42), (x,y,z), RED),
                  gem('Iris', (.3,.44,.1), (x,y,z+.36), ORANGE),
                  box('Pupil', (.07,.5,.04), (x,y,z+.45), BLACK, 0)], crystal)
    ring = empty('ring', (x, y, z))
    parts = [torus('Fire ring', r, .05, (x,y,z), RED)]
    for k in range(8):
        a, h = k*math.tau/8, (.22 if k % 2 else .14)
        parts.append(gem('Flame', (.06,h,.06), (x+math.cos(a)*r, y+h*.6, z+math.sin(a)*r), ORANGE))
    merge('Fire ring', parts, ring)


def hq_horn(side, cx, cz, y0, h, w0=.55, bow=.6):
    # A prong rising from the crown: bows outward, then hooks back in towards the eye, with barbs.
    n = 7
    pts = [(cx + side*(.8 + bow*math.sin(math.pi*i/n*.9) - .35*(i/n)**2), y0 + h*i/n, cz) for i in range(n+1)]
    out = []
    for i in range(n):
        a, b = pts[i], pts[i+1]
        w = w0*(1 - i/n*.8)
        out.append(beam('Horn', a, b, w, MACHINE, 0))
        if i in (2, 4):
            out.append(beam('Barb', b, (b[0]+side*.45, b[1]+.25, b[2]), w*.45, BLACK, 0))
    return out + [gem('Horn tip', (.09,.14,.09), pts[-1], RED)]


def hq_slits(cx, cz, half, y, pair=True):
    # Red window slits on the four faces of a tier.
    out = []
    for k in range(4):
        a = k*math.pi/2
        for d in ((-.35, .35) if pair else (0,)):
            px, pz = cx + math.cos(a)*half - math.sin(a)*d, cz + math.sin(a)*half + math.cos(a)*d
            out.append(tbox('Window slit', (.06,.45,.04), (px,y,pz), RED, (0,math.pi/2-a,0), 0))
    return out


def machine_hq():
    # Dark tower: four battered tiers with red window slits and spiked corner buttresses, a crown
    # of fire and two barbed horns cradling the Eye. A gate opens at the foot; a spiked bastion and
    # the rotating sensor mast stand on the right of the lot.
    reset()
    top = .28
    objects = platform(7.8,5.8,True)
    cx, cz = -.5, 0
    for w, d, y0, y1, inset, tint in ((5.4,4.9,top,1.3,.6,MACHINE), (3.6,3.4,1.3,3.3,.5,MPLATE),
                                      (2.9,2.7,3.3,5.1,.5,MACHINE), (2.3,2.1,5.1,6.5,.4,MPLATE)):
        objects += [armor('Tower tier',w,d,y0,y1,inset,(cx,cz),tint),
                    armor('Tier lip',w-inset+.3,d-inset+.3,y1-.05,y1+.08,.1,(cx,cz),BLACK)]
    objects += hq_slits(cx,cz,1.62,2.4) + hq_slits(cx,cz,1.3,4.2) + hq_slits(cx,cz,1.03,5.8,False)
    objects += [armor('Crown',2.6,2.4,6.5,6.9,-.3,(cx,cz),BLACK),
                armor('Crown glow',2.92,2.72,6.8,6.85,.02,(cx,cz),RED),
                rod('Fire pit',.45,(cx,6.92,cz),.04,RED,'y',12),
                rod('Pit rim',.55,(cx,6.91,cz),.03,MPLATE,'y',12)]
    for sx in (-1,1):
        for sz in (-1,1):
            for hx, hz, y0, y1, r in ((1.75,1.6,top,3.9,.3), (1.4,1.3,3.3,5.7,.22)):
                x, z = cx+sx*hx, cz+sz*hz
                objects += [armor('Buttress',2*r+.2,2*r+.2,y0,y1,.2,(x,z),MACHINE),
                            cone('Buttress spike',r,.01,.9,(x,y1+.45,z),BLACK,6)]
        objects += hq_horn(sx,cx,cz,6.8,2.2)
    objects += [armor('Gate',1.6,.8,top,1.6,.3,(cx,2.45),MACHINE),
                box('Gate dark',(.8,1.0,.06),(cx,.8,2.86),DEEP,0),
                box('Gate glow',(1.0,.06,.04),(cx,1.4,2.87),RED,0),
                armor('Bastion',1.4,1.4,top,2.2,.35,(3.0,1.6),MACHINE),
                cone('Bastion spike',.3,.01,.8,(3.0,2.6,1.6),BLACK,6),
                armor('Mast footing',.9,.9,top,.7,.3,(3.0,-1.4),BLACK),
                rod('Sensor mast',.1,(3.0,1.5,-1.4),1.6,BLACK,'y',8)]
    merge('Dark tower',objects)
    dish = empty('dish',(3.0,2.25,-1.4))
    merge('Sensor head',[box('Sensor bar',(1.0,.1,.2),(3.0,2.29,-1.4),MPLATE),
                         gem('Sensor eye',(.12,.1,.12),(3.47,2.29,-1.4),RED),
                         rod('Sensor hub',.13,(3.0,2.25,-1.4),.14,BLACK,'y',8)],dish)
    hq_eye(cx,8.0,cz)
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
    # Semi-elliptic shell band along X; theta 0 = front foot, pi = rear foot.
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


def mine_site():
    base = tech_slab(5)
    base += [cyl('Borehole',1.05,.05,(0,SLAB+.03,-.6),SOOT,vertices=16),
             torus('Shaft collar',1.05,.16,(0,SLAB+.15,-.6),IRON),
             box('Control pad',(2.1,.14,1.6),(-2.35,SLAB+.07,2.05),CONCRETE_L)]
    for sx in (-1,1):
        for sz in (-1,1):
            base.append(box('Derrick footing',(.65,.28,.65),(sx*1.12,SLAB+.14,-.6+sz*1.12),CONCRETE_L))
    # Exposed green crystals make this economic site readable even while in ruins.
    for i,(x,z,h) in enumerate(((2.6,2.2,.75),(2.15,2.55,1.1),(2.9,2.75,.6),(2.55,1.65,.5))):
        base.append(xform(gem('Tibero crystal',(.22,h,.24),(x,SLAB+h+.04,z),TIBERO),
                          (0,i*.5,(i-1)*.12),(x,SLAB,z)))
    lamp_parts, lamp = beacon_post(-3.35,3.35)
    base += lamp_parts
    intact = truss(0,-.6,.65,6.2,1.6,.58,4,4,.19,.1,RUST_D,IRON)
    intact += [armor('Drill motor',1.5,1.4,6.15,6.65,.25,(0,-.6),PRIMER),
               cyl('Motor cap',.4,.18,(0,6.74,-.6),IRON),
               box('Control hut',(1.85,1.4,1.35),(-2.35,1.08,2.05),CONCRETE,.06),
               box('Hut roof',(2.05,.15,1.5),(-2.35,1.86,2.05),SHEET),
               box('Control door',(.62,1.12,.04),(-2.35,.96,2.75),DOOR,.01),
               box('Status screen',(.5,.32,.06),(-1.78,1.2,2.75),TEAL,.01),
               cyl('Processing tank',.65,2.3,(2.55,1.5,-.7),PRIMER,vertices=12),
               cone('Tank cap',.65,.3,.4,(2.55,2.85,-.7),IRON,12),
               pipe('Transfer pipe',(.4,1.0,-.6),(2.55,1.0,-.7),.18,IRON),
               box('Hazard band',(1.52,.13,1.42),(0,6.34,-.6),HAZARD,.01)]
    for y in (1.15,1.5,1.85):
        intact.append(torus('Tank band',.66,.035,(2.55,y,-.7),IRON))
    wreck = truss(0,-.6,.65,2.1,1.6,1.15,4,1,.19,.1,RUST_D,IRON)
    wreck += [tbox('Fallen drill motor',(1.5,.7,1.4),(.2,.78,1.9),PRIMER,(.12,.4,.3)),
              tbox('Broken pipe',(2.0,.23,.23),(1.7,.48,-1.4),RUST,(.1,.3,.1)),
              box('Ruined hut wall',(1.85,.68,.25),(-2.35,.72,1.45),CONCRETE),
              tbox('Hut roof debris',(1.8,.12,1.25),(-2.4,.53,2.25),SHEET,(.15,.2,.1)),
              xform(cyl('Fallen processing tank',.62,1.8,(0,0,0),RUST,vertices=12),
                    (math.pi/2,0,.12),(0,0,0),(2.55,.92,-.8))]
    wreck += rubble(0,-.1,2.5,18,56,(CONCRETE,IRON,RUST_D,PRIMER),.26,.32)
    wreck.append(scorch(0,-.6,1.6,55,.29))
    return base, intact, wreck, lamp


def radar_site():
    base = tech_slab(6)
    base += [armor('Radar footing',3.4,3.4,SLAB,.65,.3,(0,-.5),CONCRETE),
             box('Control pad',(2.3,.1,1.9),(-2.3,.3,2.3),CONCRETE_L),
             box('Generator pad',(1.6,.1,2.2),(2.65,.3,1.1),CONCRETE_L)]
    lamp_parts, lamp = beacon_post(-3.35,3.35)
    base += lamp_parts
    intact = truss(0,-.5,.65,5.35,1.45,.65,4,3,.21,.1,IRON,RUST_D)
    intact += [cyl('Antenna bearing',.6,.3,(0,5.45,-.5),STEEL,vertices=12),
               box('Control cabin',(2.05,1.5,1.65),(-2.3,1.15,2.3),CONCRETE,.06),
               box('Cabin roof',(2.25,.16,1.85),(-2.3,1.98,2.3),SHEET),
               box('Control door',(.63,1.15,.04),(-2.65,1.0,3.14),DOOR,.01),
               box('Observation window',(.65,.4,.04),(-1.8,1.45,3.14),GLASS,.01),
               armor('Power converter',1.3,1.85,.4,1.7,.15,(2.65,1.1),PRIMER),
               pipe('Signal conduit',(0,.76,-.5),(-1.8,.76,2.2),.1,IRON)]
    for z in (.55,.8,1.05,1.3,1.55):
        intact.append(box('Cooling grille',(1.05,.025,.1),(2.65,1.71,z),DARK,.005))
    wreck = truss(0,-.5,.65,1.7,1.45,1.05,4,1,.21,.1,IRON,RUST_D)
    wreck += [box('Ruined cabin wall',(2.05,.8,.25),(-2.3,.75,1.5),CONCRETE),
              tbox('Cabin roof debris',(2.0,.12,1.6),(-2.3,.56,2.35),SHEET,(.1,.2,.15)),
              tbox('Broken converter',(1.2,.8,1.7),(2.65,.8,1.1),RUST,(.1,-.15,.2))]
    broken = bowl('Fallen radar reflector',dish_profile(1.65,.35),SHEET,.07,16,5.2,.5)
    wreck.append(xform(broken,(.35,0,-.1),(0,0,0),(.1,.8,1.35)))
    wreck += rubble(0,-.2,2.3,16,61,(CONCRETE,IRON,RUST_D,PRIMER),.25,.32)
    return base, intact, wreck, lamp


TECH_SITES = {'silo': (silo_site, 5.0), 'ion': (ion_site, 8.5), 'mammoth': (mammoth_site, 6.0),
              'juggernaut': (jug_site, 8.0), 'mine': (mine_site, 7.0), 'radar': (radar_site, 8.2)}


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
    intact_node = empty('intact',(0,0,0))
    merge('Intact structure', intact, intact_node)
    if kind == 'mine':
        auger = [cyl('Drill shaft',.18,5.3,(0,3.35,-.6),IRON)]
        for y in (1.0,1.35,1.7,2.05):
            auger.append(tbox('Auger flight',(.78,.1,.35),(0,y,-.6),STEEL,(0,y*2,.2)))
        check_fit('t_mine drill',auger,height)
        merge('Extraction auger',auger,empty('drill',(0,.65,-.6),intact_node))
    if kind == 'radar':
        reflector = bowl('Surveillance reflector',dish_profile(2.0,.48),CONCRETE_L,.065,24)
        rim = torus('Reflector rim',2.0,.06,(0,.48,0),IRON)
        head = group([reflector,rim],(1.05,0,0),(0,0,0),(0,5.75,-.5))
        head += [beam('Elevation mount',(0,5.5,-.5),(0,5.9,-.4),.22,STEEL),
                 beam('Receiver support',(-1.25,6.1,.8),(0,6.3,1.0),.075,IRON),
                 beam('Receiver support',(1.25,6.1,.8),(0,6.3,1.0),.075,IRON),
                 cyl('Receiver horn',.14,.28,(0,6.3,1.0),TEAL,'z',10)]
        check_fit('t_radar dish',head,height)
        merge('Scanning radar head',head,empty('dish',(0,5.5,-.5),intact_node))
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


# ---------------------------------------------------------------- Siege spider (m_siege)
# Machine plasma mortar on a low, long six-legged arachnid: armoured cephalothorax with a
# sensor-eyed head, a segmented reactor abdomen, wide-stanced articulated legs, and a
# rotating deck carrying a short, thick plasma mortar between two trunnion cheeks.
SIEGE_DECK = (0, 1.38, -.05)    # turret pivot: top of the body, on the yaw axis
SIEGE_TRUNNION = (2.0, .08)     # world y, z of the mortar's elevation axis
SIEGE_REST = .35                # rest elevation (rad); the game raises it to ~0.9 when firing
SIEGE_MOUTH = 1.75              # muzzle distance along the tube from the trunnion
# Legs as (side, hip x, hip z, splay in degrees, reach); even and odd indices step in turn.
SIEGE_LEGS = ((-1,.64,.75,38,.97), (1,.64,.75,38,.97), (1,.6,.12,86,.76),
              (-1,.6,.12,86,.76), (-1,.62,-.38,140,1.0), (1,.62,-.38,140,1.0))
SIEGE_ABDOMEN = ((-.7,.34,.8,1.12), (-.95,.6,.72,1.3), (-1.25,.74,.68,1.46),
                 (-1.6,.72,.7,1.58), (-1.86,.55,.78,1.5), (-2.0,.3,.92,1.28))


def loft(name, rings, tint, bevel=.02):
    # Chamfered octagonal hull lofted along Z through (z, half width, bottom, top) sections.
    verts = []
    for z, hw, yb, yt in rings:
        cb, ct = min(hw, yt-yb)*.3, min(hw, yt-yb)*.45
        verts += [(-hw,yb+cb,z), (-hw+cb,yb,z), (hw-cb,yb,z), (hw,yb+cb,z),
                  (hw,yt-ct,z), (hw-ct,yt,z), (-hw+ct,yt,z), (-hw,yt-ct,z)]
    n = len(rings)
    faces = [tuple(range(8)), tuple(range(8*n-8, 8*n))]
    faces += [(8*r+i, 8*r+(i+1)%8, 8*r+8+(i+1)%8, 8*r+8+i) for r in range(n-1) for i in range(8)]
    return solid(name, verts, faces, tint, bevel)


def strut(name, a, b, r, tint, n=6):
    # Unbevelled n-gon rod from a to b: a cheaper pipe() for cables and hydraulics.
    d = Vector(b) - Vector(a)
    rod_ = rod(name, r, (0,d.length/2,0), d.length, tint, 'y', n)
    return xform(rod_, (math.acos(d.y/d.length), math.atan2(d.x, d.z), 0), (0,0,0), a)


def bone(name, a, b, width, depth, inset, tint, bevel=0):
    # Tapered, chamfered armour segment from joint a to joint b (both in one x = const plane).
    tilt = math.atan2(b[2]-a[2], b[1]-a[1])
    seg = armor(name, width, depth, 0, math.hypot(b[2]-a[2], b[1]-a[1]), inset, (0,0), tint, bevel)
    return xform(seg, (tilt,0,0), (0,0,0), a)


def abdomen_top(z):
    for (z0,_,_,t0), (z1,_,_,t1) in zip(SIEGE_ABDOMEN, SIEGE_ABDOMEN[1:]):
        if z1 <= z <= z0:
            return t0 + (t1-t0)*(z-z0)/(z1-z0)
    return SIEGE_ABDOMEN[-1][3]


def siege_leg(i, side, hx, hz, splay, k):
    # Authored pointing +Z from the hip; the pivot then splays it about the vertical axis.
    hx *= side
    pivot = empty(f'spider_{i}', (hx,1.0,hz))
    P = lambda u, y: (hx, y, hz + u*k)
    profile = lambda name, pts, w, tint: prism(name, [(hz+u*k, y) for u,y in pts], hx-w, hx+w, tint, 'zy')
    parts = [box('Coxa',(.26,.22,.42*k),P(.21,1.02),MPLATE,0),
             rod('Coxa joint',.12,P(.4,1.04),.32,BLACK,'x',8),
             bone('Femur',P(.4,1.04),P(.9,1.82),.24,.2,.07,MACHINE,.02),
             beam('Femur spine',P(.47,1.2),P(.86,1.86),.09,MPLATE,0),
             strut('Femur ram',P(.28,.92),P(.6,1.33),.05,BLACK),
             strut('Femur ram rod',P(.6,1.33),P(.8,1.62),.028,STEEL,5),
             rod('Knee joint',.14,P(.9,1.82),.3,BLACK,'x',8),
             rod('Knee hub',.08,P(.9,1.82),.36,MPLATE,'x',6),
             profile('Knee spike',[(.76,1.9),(1.0,1.92),(.84,2.03)],.05,MPLATE),
             bone('Tibia armor',P(.9,1.82),P(1.2,.66),.26,.24,.11,MPLATE,.02),
             beam('Tibia strut',P(1.17,.8),P(1.3,.34),.13,BLACK,0),
             strut('Knee actuator',P(.7,1.56),P(1.06,1.3),.045,BLACK),
             rod('Ankle joint',.085,P(1.3,.34),.24,MACHINE,'x',6),
             profile('Foot pad',[(1.16,.4),(1.42,.24),(1.48,0),(1.18,0),(1.1,.2)],.11,MACHINE)]
    for dx in (-.07,.07):
        parts.append(prism('Toe claw',[(hz+1.4*k,.14),(hz+1.58*k,0),(hz+1.42*k,0)],hx+dx-.03,hx+dx+.03,BLACK,'zy'))
    merge('Leg', parts, pivot)
    pivot.rotation_euler.z = side*math.radians(splay)
    return pivot


def siege_body():
    parts = [armor('Belly',1.1,1.8,.64,.84,.1,(0,.3),BLACK,0),
             armor('Thorax',1.5,1.9,.82,1.3,.4,(0,.3),MACHINE),
             armor('Dorsal plate',1.08,1.48,1.3,1.335,.06,(0,.3),MPLATE,0),
             loft('Head',[(1.1,.46,.72,1.2),(1.45,.4,.74,1.16),(1.7,.27,.8,1.04)],MACHINE),
             tbox('Head plate',(.5,.04,.34),(0,1.165,1.36),MPLATE,(.12,0,0),0),
             rod('Waist',.22,(0,1.0,-.68),.3,BLACK,'z',8)]
    # Spider eye cluster: two big sensors, four small ones on the face and two on the crown.
    for s in (-1,1):
        parts += [gem('Main eye',(.075,.075,.05),(s*.1,.94,1.7),RED),
                  gem('Side eye',(.042,.042,.03),(s*.21,.9,1.665),RED),
                  gem('Upper eye',(.035,.035,.03),(s*.07,1.02,1.67),RED),
                  gem('Crown eye',(.045,.03,.045),(s*.13,1.19,1.27),RED),
                  xform(box('Chelicera',(.09,.34,.13),(s*.13,.63,1.6),MPLATE,0),(.45,0,0),(s*.13,.8,1.6)),
                  box('Fang tip',(.06,.08,.07),(s*.13,.5,1.5),BLACK,0)]
    for s, hx, hz, _, _ in SIEGE_LEGS:
        parts += [rod('Hip socket',.17,(s*hx,1.0,hz),.36,BLACK,'y',8),
                  rod('Hip cap',.2,(s*hx,1.2,hz),.05,MPLATE,'y',8)]
    # Segmented reactor abdomen: dorsal armour plates with plasma vents between them.
    parts.append(loft('Abdomen',SIEGE_ABDOMEN,MACHINE))
    for z, w in ((-1.08,.86),(-1.42,1.0),(-1.74,.86)):
        t = abdomen_top(z)
        parts.append(armor('Abdomen plate',w,.3,t-.05,t+.045,.1,(0,z),MPLATE,0))
    for z in (-1.25,-1.58):
        parts.append(box('Plasma vent',(.34,.03,.05),(0,abdomen_top(z)+.008,z),RED,0))
    for s in (-1,1):
        for z in (-1.18,-1.36,-1.54,-1.72):
            parts.append(box('Cooling fin',(.06,.3,.08),(s*.735,1.1,z),BLACK,0))
        parts.append(strut('Reactor feed',(s*.2,1.12,-1.0),(s*.3,1.2,-.5),.045,BLACK))
    parts += [rod('Tail exhaust',.12,(0,1.1,-1.98),.1,BLACK,'z',8),
              rod('Exhaust ring',.145,(0,1.1,-1.96),.04,MPLATE,'z',8)]
    return parts


def siege_deck():
    ty, tz = SIEGE_TRUNNION
    parts = [rod('Turret bearing',.7,(0,1.39,-.05),.1,BLACK,'y',16),
             armor('Deck glacis',.74,.3,1.44,1.58,.1,(0,.5),MPLATE,0),
             armor('Power cell',.74,.25,1.44,1.66,.08,(0,-.66),MACHINE,0)]
    for x in (-.2,0,.2):
        parts.append(box('Cell grille',(.12,.02,.14),(x,1.66,-.66),BLACK,0))
    for s in (-1,1):
        cheek = [(tz-.42,1.44),(tz+.4,1.44),(tz+.4,ty-.06),(tz+.2,ty+.2),(tz-.16,ty+.2),(tz-.42,ty-.02)]
        # Sponsons flare outward so the legs' femurs pass beneath them as the deck turns.
        parts += [armor('Sponson',.44,.84,1.44,1.7,-.16,(s*.66,-.05),MACHINE),
                  armor('Sponson plate',.54,.9,1.7,1.74,.06,(s*.66,-.05),MPLATE,0),
                  prism('Trunnion cheek',cheek,s*.37,s*.5,MPLATE,'zy'),
                  rod('Trunnion bearing',.19,(s*.56,ty,tz),.14,BLACK,'x',12),
                  rod('Bearing cap',.12,(s*.645,ty,tz),.03,MPLATE,'x',8),
                  rod('Trunnion pin',.1,(s*.4225,ty,tz),.155,STEEL,'x',8),
                  # Plasma capacitor tank on each sponson, with a charge sight-glass.
                  rod('Capacitor tank',.15,(s*.74,1.9,.05),.8,BLACK,'z',12),
                  box('Tank saddle',(.3,.08,.12),(s*.74,1.77,-.2),MACHINE,0),
                  box('Tank saddle',(.3,.08,.12),(s*.74,1.77,.3),MACHINE,0),
                  rod('Tank band',.158,(s*.74,1.9,.05),.05,MPLATE,'z',12),
                  box('Charge glass',(.02,.05,.4),(s*.893,1.9,.05),RED,0),
                  strut('Charge cable',(s*.68,1.95,.44),(s*.6,1.93,.22),.03,BLACK,5),
                  strut('Tank feed',(s*.66,1.84,-.36),(s*.34,1.62,-.62),.03,BLACK,5)]
        for z in (-.35,.45):
            parts.append(rod('Tank cap',.165,(s*.74,1.9,z),.06,MPLATE,'z',12))
    # Targeting mast and ranging dish (left), radiator block (right).
    dish = xform(bowl('Ranging dish',dish_profile(.2,.07,3),MPLATE,.03,10),(math.pi/2-.5,0,0),(0,0,0),(-.74,2.62,-.48))
    parts += [box('Mast base',(.18,.08,.18),(-.74,1.77,-.48),BLACK,0),
              rod('Sensor mast',.05,(-.74,2.08,-.48),.66,MACHINE,'y',6),
              box('Sensor head',(.24,.15,.2),(-.74,2.46,-.48),MPLATE,.02),
              box('Sensor lens',(.12,.06,.02),(-.74,2.47,-.375),RED,0),
              dish,
              box('Radiator',(.3,.16,.3),(.74,1.82,-.48),MACHINE,.02)]
    for z in (-.58,-.48,-.38):
        parts.append(box('Radiator fin',(.28,.05,.035),(.74,1.92,z),BLACK,0))
    return parts


def siege_mortar():
    # Authored level along +Z from the trunnion; the `barrel` pivot supplies the elevation.
    ty, z0 = SIEGE_TRUNNION
    house = [(-.3,ty-.18),(-.2,ty-.28),(.2,ty-.28),(.3,ty-.18),(.3,ty+.18),(.2,ty+.28),(-.2,ty+.28),(-.3,ty+.18)]
    cap = [(x*.8, ty+(y-ty)*.8) for x,y in house]
    parts = [prism('Breech housing',house,z0-.42,z0+.36,MACHINE,'xy',.02),
             prism('Breech cap',cap,z0-.47,z0-.42,BLACK,'xy'),
             box('Accelerator spine',(.3,.08,.6),(0,ty+.31,z0-.05),MPLATE,.015),
             rod('Trunnion collar',.17,(0,ty,z0),.64,BLACK,'x',10),
             rod('Recoil jacket',.27,(0,ty,z0+.51),.3,MPLATE,'z',12),
             rod('Mortar tube',.21,(0,ty,z0+.9),1.2,MACHINE,'z',12),
             xform(cone('Muzzle bell',.24,.31,.22,(0,ty,z0+1.6),MACHINE,12),(math.pi/2,0,0),(0,ty,z0+1.6)),
             rod('Muzzle lip',.32,(0,ty,z0+1.71),.06,MPLATE,'z',12),
             rod('Bore',.22,(0,ty,z0+1.744),.012,BLACK,'z',12),
             rod('Plasma charge',.13,(0,ty,z0+SIEGE_MOUTH),.012,RED,'z',10)]
    for s in (-1,1):
        parts += [box('Breech plate',(.03,.3,.62),(s*.31,ty,z0-.04),MPLATE,0),
                  strut('Power conduit',(s*.24,ty+.18,z0+.2),(s*.2,ty+.2,z0+.77),.035,BLACK),
                  rod('Recoil buffer',.06,(s*.1,ty-.24,z0+.58),.55,MPLATE,'z',8)]
    for x in (-.12,0,.12):
        parts.append(box('Heat sink',(.04,.34,.05),(x,ty,z0-.48),BLACK,0))
    # Accelerator collars with the plasma glow showing between them.
    for z in (.82,1.04,1.26):
        parts.append(rod('Charge collar',.28,(0,ty,z0+z),.1,MPLATE,'z',12))
    for z in (.93,1.15):
        parts.append(rod('Charge glow',.235,(0,ty,z0+z),.11,RED,'z',12))
    return parts


def siege_spider():
    reset()
    for i, leg in enumerate(SIEGE_LEGS):
        siege_leg(i, *leg)
    merge('Carapace', siege_body())
    t = empty('turret', SIEGE_DECK)
    ty, tz = SIEGE_TRUNNION
    b = empty('barrel', (0, ty-SIEGE_DECK[1], tz-SIEGE_DECK[2]), t)
    merge('Gun deck', siege_deck(), t)
    merge('Plasma mortar', siege_mortar(), b)
    empty('muzzle', (0,0,SIEGE_MOUTH), b)
    # Game Y-up tilt: native X rotation has the same sign.
    b.rotation_euler.x = -SIEGE_REST
    save('m_siege')


# ---------------------------------------------------------------- Soldador (m_welder)
# Machine field-repair walker: a wide, crab-like armoured shell on four short, chunky legs,
# two heavy manipulator arms reaching forward (pincer claw left, plasma torch right), a teal
# scanning head between the shoulders, gas tanks along the deck and a small recovery boom.
# Legs as (side, hip x, hip z, splay in degrees); 0/2 and 1/3 are the diagonal gait pairs.
WELD_LEGS = ((-1,.5,.02,62), (1,.5,.02,62), (1,.5,-.74,118), (-1,.5,-.74,118))
WELD_HIP = .78
WELD_ARM = ((.42,1.24,.5), (.8,1.98,.8), (.5,1.76,1.29))     # shoulder, elbow, wrist (x mirrored)
WELD_TORCH = (.14,1.48,1.9)     # the torch points from the right wrist towards this point
WELD_TORCH_LEN = .56            # wrist to the hot tip, where the welding arc starts


def limb(name, a, b, width, depth, inset, tint, bevel=0):
    # Tapered, chamfered armour segment from joint a to joint b in any direction.
    d = Vector(b) - Vector(a)
    seg = armor(name, width, depth, 0, d.length, inset, (0,0), tint, bevel)
    return xform(seg, (math.acos(d.y/d.length), math.atan2(d.x, d.z), 0), (0,0,0), a)


def aim(objs, origin, target):
    # Parts authored along +Z from the origin (+Y up) are turned to point at target and moved to origin.
    d = Vector(target) - Vector(origin)
    return group(objs, (math.atan2(-d.y, math.hypot(d.x, d.z)), math.atan2(d.x, d.z), 0), (0,0,0), origin)


def welder_leg(i, side, hx, hz, splay):
    # Same convention as siege_leg: authored pointing +Z from the hip, splayed by the pivot.
    # The hip sits under the shell rim, so only the femur and knee rise past the carapace edge.
    hx *= side
    h = WELD_HIP
    pivot = empty(f'spider_{i}', (hx,h,hz))
    P = lambda u, y: (hx, y, hz + u)
    profile = lambda name, pts, w, tint, dx=0: prism(name, [(hz+u, y) for u,y in pts], hx+dx-w, hx+dx+w, tint, 'zy')
    knee, ankle = (.68,1.5), (1.07,.24)
    parts = [box('Coxa',(.26,.22,.42),P(.21,h),MPLATE,0),
             rod('Coxa joint',.13,P(.42,h+.02),.34,BLACK,'x',8),
             bone('Femur',P(.42,h+.02),P(*knee),.3,.26,.08,MACHINE,.02),
             beam('Femur spine',P(.48,h+.22),P(.68,1.58),.11,MPLATE,0),
             strut('Femur ram',P(.24,h-.1),P(.5,1.08),.05,BLACK),
             strut('Femur ram rod',P(.5,1.08),P(.62,1.32),.028,STEEL,5),
             rod('Knee joint',.16,P(*knee),.36,BLACK,'x',10),
             rod('Knee hub',.095,P(*knee),.42,MPLATE,'x',6),
             profile('Knee guard',[(.52,1.62),(.72,1.76),(.9,1.62),(.84,1.48)],.1,MPLATE),
             bone('Tibia armor',P(*knee),P(1.01,.48),.3,.28,.1,MPLATE,.02),
             beam('Tibia strut',P(.99,.58),P(*ankle),.15,BLACK,0),
             strut('Knee actuator',P(.5,1.32),P(.9,1.06),.045,BLACK),
             rod('Ankle joint',.09,P(*ankle),.28,MACHINE,'x',8),
             profile('Foot pad',[(.95,.28),(1.1,.22),(1.16,0),(.88,0),(.86,.14)],.13,MACHINE)]
    for dx in (-.09,0,.09):
        parts.append(profile('Toe claw',[(1.08,.12),(1.19,0),(1.08,0)],.026,BLACK,dx))
    merge('Leg', parts, pivot)
    pivot.rotation_euler.z = side*math.radians(splay)
    return pivot


def welder_torch():
    # Plasma torch: banded barrel under a heat hood, steel nozzle and a glowing tip.
    L = WELD_TORCH_LEN
    tip = xform(cone('Hot tip',.042,.012,.07,(0,0,L-.035),ORANGE,8),(math.pi/2,0,0),(0,0,L-.035))
    return [rod('Wrist collar',.14,(0,0,.04),.08,BLACK,'z',10),
            rod('Torch body',.12,(0,0,.2),.26,MPLATE,'z',10),
            rod('Torch band',.13,(0,0,.11),.04,BLACK,'z',8),
            rod('Torch band',.13,(0,0,.29),.04,BLACK,'z',8),
            tbox('Heat hood',(.32,.03,.3),(0,.15,.25),MACHINE,(-.12,0,0),.01),
            box('Gas valve',(.07,.08,.08),(.1,.1,.14),STEEL,.01),
            xform(cone('Nozzle',.075,.036,.16,(0,0,L-.15),STEEL,8),(math.pi/2,0,0),(0,0,L-.15)),
            tip]


def welder_claw():
    # Crab pincer opening sideways, so it reads from above: a heavy outer finger and an inner one.
    outer = [(.04,.24),(.23,.24),(.26,.42),(.2,.58),(.04,.7),(.09,.55),(.12,.42),(.04,.34)]
    inner = [(-.04,.24),(-.18,.24),(-.23,.38),(-.21,.52),(-.1,.64),(-.11,.51),(-.1,.4),(-.04,.33)]
    return [rod('Wrist collar',.14,(0,0,.04),.08,BLACK,'z',10),
            box('Claw palm',(.4,.3,.26),(0,0,.16),MACHINE,.03),
            rod('Jaw pin',.07,(0,0,.28),.34,BLACK,'y',8),
            prism('Claw finger',outer,-.08,.08,MPLATE,'xz'),
            prism('Claw finger',inner,-.065,.065,MPLATE,'xz'),
            prism('Claw tip',[(.04,.62),(.14,.54),(.04,.7)],-.082,.082,BLACK,'xz'),
            prism('Claw tip',[(-.1,.58),(-.17,.5),(-.1,.64)],-.067,.067,BLACK,'xz')]


def welder_arm(s):
    # Crab cheliped: the elbow swings out and up, the forearm folds back in towards the tool.
    S, E, W = [Vector((s*x,y,z)) for x,y,z in WELD_ARM]
    def up(a, b, k):
        # Offset k along the side of segment a-b that faces up.
        d = (b - a).normalized()
        return (Vector((0,1,0)) - d * d.y).normalized() * k
    T = lambda v: tuple(v)
    u1, u2 = up(S, E, .17), up(E, W, .16)
    parts = [box('Shoulder mount',(.3,.42,.28),(s*.4,S.y-.1,S.z-.04),MACHINE,.03),
             rod('Shoulder drum',.2,T(S),.36,BLACK,'x',10),
             rod('Shoulder cap',.13,(s*.61,S.y,S.z),.04,MPLATE,'x',8),
             limb('Upper arm',T(S),T(E),.34,.3,.06,MACHINE,.02),
             limb('Arm plate',T(S+u1+(E-S)*.08),T(E+u1*.9-(E-S)*.12),.38,.06,.1,MPLATE),
             strut('Arm ram',(s*.4,S.y-.28,S.z+.12),T(S+(E-S)*.55-u1),.055,BLACK),
             strut('Arm ram rod',T(S+(E-S)*.55-u1),T(S+(E-S)*.75-u1*.8),.032,STEEL,5),
             rod('Elbow joint',.15,T(E),.36,BLACK,'x',10),
             rod('Elbow hub',.09,T(E),.42,MPLATE,'x',6),
             limb('Forearm',T(E),T(W),.32,.28,.08,MPLATE,.02),
             strut('Forearm ram',T(E+u2+(W-E)*.1),T(W+u2*.9-(W-E)*.12),.035,BLACK,5),
             rod('Wrist joint',.12,T(W),.34,BLACK,'x',8)]
    if s > 0:
        parts += aim(welder_torch(), T(W), WELD_TORCH)
    else:
        parts += aim(welder_claw(), T(W), (s*.16,1.5,1.92))
    return parts


def welder_body():
    parts = [armor('Belly',.8,1.3,.42,.58,.1,(0,-.3),BLACK,0),
             loft('Hull',[(-1.05,.4,.5,1.0),(-.75,.5,.46,1.02),(.15,.5,.46,1.02),(.55,.4,.5,1.0)],MACHINE,0),
             # Wide, rounded crab shell overhanging the hips, with a raised dorsal plate.
             loft('Carapace',[(-1.12,.36,1.0,1.18),(-.96,.6,.98,1.3),(-.66,.74,.97,1.38),(-.15,.8,.97,1.43),
                              (.25,.78,.98,1.41),(.5,.66,1.0,1.33),(.64,.44,1.03,1.24)],MACHINE,0),
             loft('Dorsal plate',[(-.96,.38,1.24,1.33),(-.7,.56,1.32,1.44),(-.15,.62,1.37,1.47),
                                  (.25,.6,1.36,1.455),(.48,.42,1.27,1.37)],MPLATE,0),
             # Repair emblem: a teal cross on a dark hexagon in the middle of the deck.
             prism('Emblem plate',[(.21*math.cos(a),-.34+.21*math.sin(a)) for a in [k*math.tau/6 for k in range(6)]],
                   1.45,1.485,BLACK,'xz'),
             box('Emblem cross',(.26,.02,.075),(0,1.49,-.34),TEAL,0),
             box('Emblem cross',(.075,.02,.26),(0,1.49,-.34),TEAL,0),
             box('Face plate',(.56,.26,.06),(0,.78,.56),MPLATE,.02),
             box('Face visor',(.36,.05,.02),(0,.82,.595),TEAL,0)]
    for s, hx, hz, _ in WELD_LEGS:
        parts.append(rod('Hip socket',.18,(s*hx,WELD_HIP,hz),.28,BLACK,'y',8))
    for s in (-1,1):
        # Gas tanks along the deck with a teal coolant band, saddles and a valve.
        parts += [rod('Gas tank',.15,(s*.42,1.62,-.58),.76,BLACK,'z',12),
                  rod('Tank cap',.11,(s*.42,1.62,-.18),.05,MPLATE,'z',8),
                  rod('Tank cap',.11,(s*.42,1.62,-.98),.05,MPLATE,'z',8),
                  box('Tank saddle',(.28,.1,.1),(s*.42,1.48,-.34),MACHINE,0),
                  box('Tank saddle',(.28,.1,.1),(s*.42,1.48,-.82),MACHINE,0),
                  rod('Coolant band',.158,(s*.42,1.62,-.58),.08,TEAL,'z',12),
                  rod('Tank valve',.035,(s*.42,1.78,-.24),.07,STEEL,'y',6)]
        parts += welder_arm(s)
    # Scanning sensor head between the shoulders.
    parts += [rod('Sensor neck',.1,(0,1.46,.3),.1,BLACK,'y',8),
              loft('Sensor head',[(.1,.19,1.5,1.74),(.42,.2,1.5,1.74),(.6,.14,1.53,1.7)],MPLATE,0),
              rod('Lens ring',.095,(0,1.62,.6),.04,BLACK,'z',12),
              rod('Sensor lens',.07,(0,1.62,.62),.02,TEAL,'z',12),
              box('Scanner bar',(.24,.03,.02),(0,1.7,.55),TEAL,0)]
    for s in (-1,1):
        parts.append(box('Scanner fin',(.03,.14,.18),(s*.11,1.8,.2),MACHINE,0))
    # Recovery boom raised over the tail: turntable, post, lift ram, hoist and hook.
    bz0, bz1, by0, by1 = -.8, -1.4, 1.72, 2.36
    parts += [rod('Crane turntable',.2,(0,1.44,-.8),.06,BLACK,'y',16),
              box('Crane post',(.24,.3,.28),(0,1.62,-.8),MPLATE,.03),
              limb('Boom',(0,by0,bz0),(0,by1,bz1),.17,.19,.05,MPLATE),
              rod('Boom pivot',.1,(0,by0,bz0),.3,BLACK,'x',8),
              rod('Boom sheave',.08,(0,by1,bz1),.22,BLACK,'x',8),
              strut('Lift ram',(0,1.48,-.6),(0,1.78,-.86),.05,BLACK),
              strut('Lift ram rod',(0,1.78,-.86),(0,2.0,-1.06),.03,STEEL,5),
              strut('Hoist cable',(0,by1-.05,bz1-.02),(0,1.86,bz1-.02),.012,BLACK,4),
              box('Hook block',(.1,.12,.08),(0,1.81,bz1-.02),BLACK,.01),
              prism('Hook',[(-.05,1.76),(.04,1.76),(.05,1.68),(-.02,1.66),(-.02,1.7),(.01,1.71),(-.01,1.74),(-.05,1.74)],
                    bz1-.05,bz1+.01,STEEL,'xy'),
              gem('Boom lamp',(.05,.04,.05),(0,by1+.07,bz1+.04),TEAL)]
    # Winch drum behind the post: the hoist cable runs from it up to the boom head.
    parts += [rod('Winch drum',.12,(0,1.38,-1.04),.3,BLACK,'x',12),
              rod('Winch flange',.17,(-.17,1.38,-1.04),.04,MPLATE,'x',10),
              rod('Winch flange',.17,(.17,1.38,-1.04),.04,MPLATE,'x',10),
              box('Winch bracket',(.42,.1,.2),(0,1.25,-1.02),MACHINE,0),
              strut('Winch cable',(0,1.48,-1.06),(0,by1-.02,bz1+.06),.012,BLACK,4),
              box('Tail plate',(.62,.3,.06),(0,.78,-1.07),MPLATE,.02)]
    for x in (-.16,0,.16):
        parts.append(box('Tail vent',(.08,.2,.02),(x,.78,-1.105),BLACK,0))
    # Tool lockers slung on the hull flanks between the hips.
    for s in (-1,1):
        parts += [box('Tool locker',(.1,.3,.38),(s*.54,.72,-.36),MACHINE,0),
                  box('Locker lid',(.03,.06,.4),(s*.6,.86,-.36),MPLATE,0)]
        for z in (-.48,-.36,-.24):
            parts.append(box('Tool handle',(.03,.24,.04),(s*.605,.74,z),STEEL,0))
    return parts


def welder():
    reset()
    for i, leg in enumerate(WELD_LEGS):
        welder_leg(i, *leg)
    merge('Welder', welder_body())
    W = Vector(WELD_ARM[2])
    tip = W + (Vector(WELD_TORCH) - W).normalized() * WELD_TORCH_LEN
    empty('muzzle', tuple(tip))
    save('m_welder')

# ---------------------------------------------------------------- Recolector (m_harv)
# Machine ore harvester: a compact bucket-wheel excavator on two crawler tracks. A slewing deck
# carries the upper works: a counterweight at the stern, an open hopper amidships where the teal
# ore heap shows from above, and a twin-girder boom held by stays from a mast with a cyclops
# sensor head. The eight-bucket wheel at the boom's tip turns front-up, scooping ore onto a belt
# that climbs the boom into the hopper. The heap's vertical extent is the `fill` height, centred
# on the node, so the game can grow it from the hopper floor.
HARV_HUB = (0,.76,1.66)         # `drill` pivot: bucket wheel axle, along X
HARV_WHEEL = .56                # bucket wheel radius at the bucket floors
HARV_BIN = (.55,-1.72,-.2,1.42,1.98)    # hopper interior: half width, rear z, front z, floor, wall top
HARV_BOOM = .1, 1.42            # boom pivot z, y (the girders run from here to the wheel axle)
HARV_BELT = ((0,1.12,.92), (0,2.02,-.3))   # conveyor belt surface: tail behind the wheel, head over the hopper
HARV_TRACK = [(-1.3,0),(.8,0),(1.1,.14),(1.2,.36),(1.1,.56),(.88,.66),(-1.38,.66),(-1.6,.56),(-1.7,.36),(-1.6,.14)]
BELT_DARK = '#1a2028'


def crawler(s, x0, x1, outline, wheels, sprockets, step=.19):
    # Crawler track on side s: a belt extruded from its (z, y) outline between |x| = x0 and x1,
    # cleats along the outline, a dark wheel bay on the outer face with road wheels (z, y, r) and
    # toothed sprockets (z, y, r) over it.
    lo, hi = sorted((s*x0, s*x1))
    xo, xc, w = s*x1, (lo+hi)/2, hi-lo
    parts = [prism('Track belt', outline, lo, hi, BELT_DARK, 'zy', .02)]
    c = sum((Vector(p) for p in outline), Vector((0,0))) / len(outline)
    for i in range(len(outline)):
        a, b = Vector(outline[i]), Vector(outline[(i+1) % len(outline)])
        d = b - a
        n = Vector((d.y, -d.x)).normalized()
        n = n if n.dot((a+b)/2 - c) > 0 else -n
        k = max(1, round(d.length/step))
        for j in range(k):
            p = a + d*((j+.5)/k) + n*.022
            parts.append(tbox('Track cleat',(w+.03,.045,.075),(xc,p.y,p.x),'#3b4550',(-math.atan2(d.y,d.x),0,0),0))
    parts.append(prism('Wheel bay', [(c.x+(z-c.x)*.86, c.y+(y-c.y)*.8) for z,y in outline], xo, xo+s*.012, DEEP, 'zy'))
    for z, y, r in wheels:
        parts += [rod('Road wheel',r,(xo+s*.03,y,z),.05,MPLATE,'x',14),
                  rod('Wheel hub',r*.45,(xo+s*.06,y,z),.03,BLACK,'x',8)]
    for z, y, r in sprockets:
        teeth = [(z + r*(1 if k % 2 else .82)*math.cos(k*math.pi/10), y + r*(1 if k % 2 else .82)*math.sin(k*math.pi/10))
                 for k in range(20)]
        parts += [prism('Sprocket',teeth,xo+s*.01,xo+s*.06,MACHINE,'zy'),
                  rod('Sprocket hub',r*.42,(xo+s*.08,y,z),.04,ORANGE,'x',8),
                  rod('Hub cap',r*.25,(xo+s*.1,y,z),.03,BLACK,'x',6)]
    return parts


def ore_heap(seed=5):
    # Lumpy ore heap filling the hopper: flat bottom on the floor, vertical sides, a crest just
    # over the rim. One heightfield mesh plus a few crystal shards sunk into its surface.
    hw, z0, z1, floor, top = HARV_BIN
    hw, z0, z1 = hw-.02, z0+.02, z1-.02
    crest, edge = top+.11, top-.18
    rnd = random.Random(seed)
    nx, nz = 6, 8
    height = lambda u, v: crest - (crest-edge)*min(1, .6*max(u,v)**1.3 + .4*(u*u+v*v)/2)
    grid = []
    for j in range(nz+1):
        for i in range(nx+1):
            u, v = abs(2*i/nx-1), abs(2*j/nz-1)
            y = height(u, v)
            if 0 < i < nx and 0 < j < nz and (u, v) != (0, 0):
                y -= rnd.uniform(0, .09)
            grid.append((-hw + 2*hw*i/nx, y, z0 + (z1-z0)*j/nz))
    idx = lambda i, j: j*(nx+1) + i
    ring = ([idx(i,0) for i in range(nx+1)] + [idx(nx,j) for j in range(1,nz+1)] +
            [idx(i,nz) for i in range(nx-1,-1,-1)] + [idx(0,j) for j in range(nz-1,0,-1)])
    n = len(grid)
    verts = grid + [(grid[k][0], floor, grid[k][2]) for k in ring]
    faces = [(idx(i,j), idx(i+1,j), idx(i+1,j+1), idx(i,j+1)) for j in range(nz) for i in range(nx)]
    m = len(ring)
    faces += [(ring[k], ring[(k+1)%m], n+(k+1)%m, n+k) for k in range(m)]
    faces.append(tuple(n+k for k in range(m)))
    parts = [solid('Ore heap', verts, faces, TEAL)]
    # Crystal shards breaking the surface, kept under the 2.1 height budget.
    for x, z, r, tilt in ((-.26,-.6,.14,(.35,0,.5)), (.24,-1.2,.17,(-.3,0,-.4)), (.06,-.86,.15,(.15,0,.2)),
                          (-.3,-1.42,.12,(-.4,0,.6)), (.34,-.56,.11,(.3,0,-.7)), (-.08,-1.18,.1,(0,0,-.3))):
        u, v = abs(x/hw), abs((2*z-z0-z1)/(z1-z0))
        y = min(height(u, v) - .03, 2.08 - r*1.35)
        parts.append(xform(gem('Ore crystal',(r*.7,r*1.4,r*.7),(x,y,z),TEAL),tilt,(x,y,z)))
    return parts


def harv_undercarriage():
    parts = []
    for s in (-1,1):
        # Lifted so the cleats under the bottom run rest on the ground.
        parts += group(crawler(s, .66, 1.14, HARV_TRACK, [(-1.0,.19,.18),(-.45,.19,.18),(.1,.19,.18),(.62,.19,.18)],
                               [(.93,.36,.28),(-1.44,.36,.28)]), move=(0,.045,0))
        parts += [box('Track cover',(.5,.08,2.3),(s*.9,.75,-.25),MPLATE,.015),
                  box('Cover lip',(.46,.05,.1),(s*.9,.71,.92),BLACK,0),
                  gem('Running light',(.05,.035,.03),(s*.9,.65,.98),RED),
                  box('Frame cross',(.32,.22,.5),(s*.52,.5,-.25),BLACK,.015)]
        for z in (-1.0,-.82,-.64):
            parts.append(box('Cover vent',(.3,.02,.07),(s*.9,.795,z),BLACK,0))
    return parts + [armor('Carbody',1.1,2.4,.3,.72,.12,(0,-.25),BLACK,0),
                    rod('Slew ring',.78,(0,.78,-.35),.12,MPLATE,'y',24),
                    rod('Slew bearing',.72,(0,.86,-.35),.06,BLACK,'y',24)]


def harv_upperworks():
    hw, z0, z1, floor, top = HARV_BIN
    parts = [loft('Upper works',[(-1.95,.66,.9,1.42),(-1.3,.7,.9,1.5),(.25,.7,.9,1.45),(.7,.6,.9,1.25)],MACHINE,0),
             armor('Counterweight',1.5,.5,.95,1.62,.1,(0,-2.05),MPLATE)]
    for x in (-.5,-.25,0,.25,.5):
        parts.append(box('Counterweight slot',(.1,.45,.02),(x,1.25,-2.31),BLACK,0))
    # Flank radiators and the bow lights of the deck.
    for s in (-1,1):
        parts += [box('Radiator',(.04,.3,.7),(s*.7,1.12,-.75),BLACK,0),
                  gem('Deck light',(.04,.03,.025),(s*.48,1.2,.74),RED)]
        for z in (-1.0,-.84,-.68,-.52):
            parts.append(box('Radiator slat',(.03,.24,.04),(s*.725,1.12,z),MPLATE,0))
    # Open hopper with steep flared walls, outer ribs and a black rim.
    wb, wt, yb = hw+.03, hw+.25, 1.4
    end = [(-wb-.08,yb),(wb+.08,yb),(wt+.08,top),(-wt-.08,top)]
    parts += [box('Hopper floor',(2*wb,.06,z1-z0),(0,floor-.03,(z0+z1)/2),BLACK,0),
              prism('Hopper rear',end,z0-.09,z0,MACHINE,'xy',.015),
              prism('Hopper front',end,z1,z1+.09,MACHINE,'xy',.015),
              box('Hopper rim',(2*wt+.2,.05,.13),(0,top+.02,z0-.05),BLACK,0),
              box('Hopper rim',(2*wt+.2,.05,.13),(0,top+.02,z1+.05),BLACK,0)]
    for s in (-1,1):
        parts += [prism('Hopper side',[(s*wb,yb),(s*(wb+.08),yb),(s*(wt+.08),top),(s*wt,top)],z0,z1,MPLATE,'xy',.015),
                  box('Hopper rim',(.12,.05,z1-z0+.18),(s*(wt+.04),top+.02,(z0+z1)/2),BLACK,0)]
        for z in (z0+.3,(z0+z1)/2,z1-.3):
            parts.append(prism('Hopper rib',[(s*(wb+.08),yb),(s*(wb+.14),yb),(s*(wt+.14),top-.04),(s*(wt+.08),top-.04)],
                               z-.035,z+.035,MACHINE,'xy'))
    return parts


def harv_boom():
    hx, hy, hz = HARV_HUB
    bz, by = HARV_BOOM
    apex = (0,2.04,.3)
    parts = []
    for s in (-1,1):
        root, tip = Vector((s*.34,by,bz)), Vector((s*.34,hy,hz))
        parts += [beam('Boom girder',tuple(root),tuple(tip),.16,MACHINE),
                  beam('Boom chord',(s*.34,1.02,.2),(s*.34,hy-.05,hz-.3),.1,MPLATE),
                  rod('Boom pivot',.12,tuple(root),.14,BLACK,'x',10),
                  rod('Wheel bearing',.16,(s*.36,hy,hz),.12,BLACK,'x',10),
                  rod('Bearing cap',.09,(s*.43,hy,hz),.04,ORANGE,'x',8),
                  beam('Mast leg',(s*.42,1.44,-.06),(s*.1,apex[1],apex[2]),.1,MPLATE),
                  strut('Boom stay',(s*.08,apex[1]-.02,apex[2]),(s*.34,hy+.18,hz-.12),.02,BLACK,5),
                  strut('Boom ram',(s*.55,.95,-.15),(s*.38,1.18,.75),.055,BLACK),
                  strut('Ram rod',(s*.38,1.18,.75),(s*.36,1.24,.9),.03,STEEL,5)]
        for t in (.25,.5,.75):
            p = root + (tip-root)*t
            parts.append(beam('Lattice',tuple(p),(s*.34,p.y-.28,p.z-.18),.05,BLACK))
    # Cyclops sensor head hung under the mast apex, over the belt, looking down the boom.
    parts += [loft('Sensor head',[(.2,.17,1.8,2.0),(.42,.21,1.78,2.05),(.6,.15,1.82,1.98)],MPLATE,0),
              tbox('Head brow',(.36,.04,.2),(0,2.04,.52),MACHINE,(.3,0,0),.01),
              gem('Main eye',(.08,.06,.04),(0,1.9,.6),RED),
              strut('Antenna',(.14,2.04,.3),(.2,2.1,.14),.014,BLACK,4)]
    for s in (-1,1):
        parts.append(gem('Side eye',(.03,.025,.02),(s*.13,1.87,.58),RED))
    # Belt from the wheel up the boom, tipping into the hopper through a discharge hood.
    A, B = Vector(HARV_BELT[0]), Vector(HARV_BELT[1])
    d = B - A
    L, pitch = d.length, math.atan2(d.y, -d.z)
    on = lambda t, k=0: tuple(A + d*t + Vector((0,k,0)))
    parts += [tbox('Belt',(.34,.05,L),on(.5,-.025),BLACK,(pitch,0,0),0),
              tbox('Belt bed',(.4,.1,L-.1),on(.5,-.1),MACHINE,(pitch,0,0),0),
              rod('Tail pulley',.07,on(0,-.07),.4,BLACK,'x',10),
              rod('Head pulley',.07,on(1,-.07),.44,MPLATE,'x',10),
              tbox('Discharge hood',(.46,.04,.3),on(.97,.1),MACHINE,(pitch*.4,0,0),.01)]
    for s in (-1,1):
        parts.append(tbox('Belt rail',(.05,.13,L),on(.5,0),MPLATE,(pitch,0,0),0))
        group(parts[-1:], move=(s*.2,0,0))
    for k in range(8):
        parts.append(tbox('Belt cleat',(.32,.035,.05),on(.06+k*.12,.015),MPLATE,(pitch,0,0),0))
    return parts


def harv_wheel():
    # Eight buckets on an open twin-rim wheel. Each is authored at the top with its toothed mouth
    # facing -Z, the way the top of the wheel travels, and turned into place about the axle.
    hx, hy, hz = HARV_HUB
    R = HARV_WHEEL
    parts = [rod('Wheel hub',.14,HARV_HUB,.62,MPLATE,'x',12),
             rod('Hub ring',.18,HARV_HUB,.12,BLACK,'x',12)]
    for s in (-1,1):
        for i in range(24):
            parts += group([box('Wheel rim',(.07,.09,2*R*math.sin(math.pi/24)+.01),(s*.23,hy+R-.04,hz),MACHINE,0)],
                           (i*math.tau/24,0,0), HARV_HUB)
    for k in range(8):
        bucket = [box('Bucket',(.38,.2,.26),(0,hy+R+.02,hz),MPLATE,.02),
                  box('Bucket mouth',(.32,.12,.02),(0,hy+R+.04,hz-.13),DEEP,0),
                  box('Bucket lip',(.4,.04,.06),(0,hy+R+.13,hz-.12),ORANGE,0),
                  beam('Spoke',(.16,hy,hz),(.16,hy+R-.05,hz),.06,BLACK),
                  beam('Spoke',(-.16,hy,hz),(-.16,hy+R-.05,hz),.06,BLACK)]
        for x in (-.12,0,.12):
            bucket.append(box('Bucket tooth',(.04,.04,.08),(x,hy+R+.15,hz-.17),ORANGE,0))
        parts += group(bucket, (k*math.tau/8,0,0), HARV_HUB)
    return parts


def bucket_excavator():
    reset()
    merge('Recolector', harv_undercarriage() + harv_upperworks() + harv_boom())
    # The runtime spins `drill` about its local Z; turned to -X here, so the wheel's front rises.
    drill = empty('drill', HARV_HUB)
    drill.rotation_euler.z = -math.pi/2
    merge('Bucket wheel', harv_wheel(), drill)
    heap = ore_heap()
    bpy.context.view_layer.update()
    ys = [(o.matrix_world @ v.co).z for o in heap for v in o.data.vertices]
    lo, hi = min(ys), max(ys)
    hw, z0, z1, floor, top = HARV_BIN
    fill = empty('fill', (0, (lo+hi)/2, (z0+z1)/2))
    fill['height'] = round(hi - lo, 4)
    merge('Mineral load', heap, fill)
    save('m_harv')


# ---------------------------------------------------------------- Segador (m_crusher)
# Machine front-line assault spider: a compact, wedge-fronted armoured hull with a red-visored
# head, four tall arched legs with scythe-crested knees and spear feet, and a heavy turret
# carrying a long plasma cannon: twin accelerator rails framing black coils with the red plasma
# core glowing between them, ending in a forked emitter. The knees stay below the cannon and the
# turret's overhangs inside the knees, so the turret can traverse freely over the legs.
# Legs as (side, hip x, hip z, splay in degrees); 0/2 and 1/3 are the diagonal gait pairs.
CRUSH_LEGS = ((-1,.58,.46,42), (1,.58,.46,42), (1,.58,-.42,132), (-1,.58,-.42,132))
CRUSH_HIP = .85
CRUSH_DECK = (0,1.4,-.05)       # turret pivot on the yaw axis
CRUSH_GUN = (1.98,.42)          # world y, z of the cannon's `barrel` pivot, inside the mantlet
CRUSH_MOUTH = 1.8               # muzzle distance along the cannon from the pivot


def side_offset(a, b, t, k):
    # Point t along the (u, y) segment a-b, pushed k off it towards +u (the leg's outer edge).
    du, dy = b[0]-a[0], b[1]-a[1]
    n = math.hypot(du, dy)
    nu, ny = dy/n, -du/n
    if nu < 0:
        nu, ny = -nu, -ny
    return (a[0] + du*t + nu*k, a[1] + dy*t + ny*k)


def crusher_leg(i, side, hx, hz, splay):
    # Same convention as siege_leg: authored pointing +Z from the hip, splayed by the pivot.
    # The hip sits low on the hull so the knee arches well above the body.
    hx *= side
    h = CRUSH_HIP
    pivot = empty(f'spider_{i}', (hx,h,hz))
    P = lambda u, y: (hx, y, hz + u)
    profile = lambda name, pts, w, tint, dx=0: prism(name, [(hz+u, y) for u,y in pts], hx+dx-w, hx+dx+w, tint, 'zy')
    hip, knee, ankle = (.3,h+.02), (.72,1.58), (1.32,.42)
    blade = [side_offset(knee, ankle, t, k) for t, k in
             ((.06,.06),(.92,.03),(.86,.1),(.6,.19),(.3,.21),(.1,.15))]
    parts = [box('Coxa',(.3,.26,.4),P(.15,h),MPLATE,0),
             rod('Coxa joint',.13,P(*hip),.34,BLACK,'x',8),
             bone('Femur',P(*hip),P(*knee),.34,.28,.09,MACHINE,.02),
             bone('Femur plate',P(*side_offset(hip,knee,.16,.15)),P(*side_offset(hip,knee,.86,.15)),.26,.05,.06,MPLATE),
             strut('Femur ram',P(.1,h-.1),P(.34,1.2),.05,BLACK),
             strut('Femur ram rod',P(.34,1.2),P(.48,1.42),.028,STEEL,5),
             rod('Knee joint',.15,P(*knee),.34,BLACK,'x',10),
             rod('Knee hub',.09,P(*knee),.4,MPLATE,'x',6),
             # Scythe crest over the knee, kept below the cannon's sweep.
             profile('Knee crest',[(.56,1.62),(.7,1.72),(.94,1.7),(1.06,1.52),(.86,1.62)],.05,MPLATE),
             bone('Tibia',P(*knee),P(*ankle),.3,.26,.14,MPLATE,.02),
             profile('Tibia blade',blade,.025,BLACK),
             strut('Knee actuator',P(.52,1.3),P(.94,1.18),.045,BLACK),
             rod('Ankle joint',.085,P(*ankle),.24,MACHINE,'x',6),
             # Spear foot: a long black spike with a short heel claw.
             profile('Spear foot',[(1.2,.52),(1.42,.46),(1.56,0),(1.38,.12)],.08,BLACK),
             profile('Heel claw',[(1.26,.3),(1.2,0),(1.34,.16)],.04,BLACK)]
    merge('Leg', parts, pivot)
    pivot.rotation_euler.z = side*math.radians(splay)
    return pivot


def crusher_body():
    h = CRUSH_HIP
    parts = [armor('Belly',.9,1.8,.36,.52,.12,(0,0),BLACK,0),
             loft('Hull',[(-1.05,.34,.62,1.0),(-.85,.56,.5,1.2),(-.3,.66,.46,1.34),(.3,.64,.46,1.34),
                          (.8,.5,.5,1.22),(1.0,.38,.56,1.1)],MACHINE,0),
             rod('Race collar',.74,(0,1.36,-.05),.05,MPLATE,'y',16),
             # Low wedge head: a brow overhanging an angry red V visor, black mandibles below.
             loft('Head',[(.78,.44,.46,1.18),(1.12,.4,.46,1.06),(1.34,.3,.5,.88)],MPLATE,0),
             tbox('Brow',(.74,.06,.42),(0,1.04,1.18),MACHINE,(.42,0,0),.01),
             box('Visor plate',(.5,.2,.02),(0,.72,1.345),BLACK,0)]
    for s in (-1,1):
        parts += [tbox('Visor slit',(.19,.045,.02),(s*.12,.74,1.36),RED,(0,0,s*.38),0),
                  gem('Side eye',(.04,.04,.03),(s*.31,.66,1.27),RED),
                  prism('Mandible',[(s*.16,1.2),(s*.32,1.3),(s*.33,1.5),(s*.2,1.66),(s*.22,1.48),(s*.2,1.32)],.46,.54,BLACK,'xz'),
                  # Flank armour between the hips, with cooling slats.
                  box('Flank armor',(.08,.38,.6),(s*.67,.86,.02),MPLATE,.015)]
        for z in (-.13,.02,.17):
            parts.append(box('Flank slat',(.03,.26,.05),(s*.72,.86,z),BLACK,0))
    for s, hx, hz, _ in CRUSH_LEGS:
        parts += [rod('Hip socket',.18,(s*hx,h,hz),.32,BLACK,'y',8),
                  tbox('Pauldron',(.34,.07,.48),(s*.55,1.2,hz),MPLATE,(0,0,-s*.42),.015)]
    # Short reactor tail: a black drum with a red core, ringed by heat sinks.
    parts += [rod('Reactor drum',.28,(0,.86,-1.1),.22,BLACK,'z',12),
              rod('Reactor core',.16,(0,.86,-1.215),.02,RED,'z',10)]
    for k in range(6):
        a = k*math.tau/6 + math.pi/6
        parts.append(tbox('Heat sink',(.05,.14,.2),(math.sin(a)*.3,.86+math.cos(a)*.3,-1.1),MPLATE,(0,0,-a),0))
    return parts


def crusher_turret():
    # Low, wide wedge on a race; armour skirts over the flank radiators, cheeks around the gun.
    gy, gz = CRUSH_GUN
    parts = [rod('Turret race',.66,(0,1.43,-.05),.08,BLACK,'y',16),
             armor('Turret hull',1.36,1.62,1.44,2.06,.52,(0,-.22),MACHINE),
             armor('Roof plate',.7,.94,2.05,2.1,.1,(0,-.3),MPLATE,0),
             rod('Mantlet',.3,(0,gy,.64),.2,MPLATE,'z',10),
             box('Reactor bustle',(.66,.24,.2),(0,1.72,-1.0),BLACK,.02)]
    for s in (-1,1):
        parts += [prism('Gun cheek',[(.1,1.5),(.68,1.56),(.84,1.78),(.74,2.12),(.24,2.16)],s*.28,s*.42,MPLATE,'zy',.015),
                  box('Radiator',(.12,.3,.8),(s*.7,1.62,-.3),BLACK,0),
                  tbox('Side skirt',(.34,.06,.96),(s*.76,1.82,-.28),MPLATE,(0,0,-s*.55),.015),
                  strut('Power conduit',(s*.62,1.9,.12),(s*.42,1.98,.4),.04,BLACK)]
        for z in (-.56,-.4,-.24,-.08):
            parts.append(box('Radiator fin',(.05,.26,.05),(s*.77,1.62,z),MPLATE,0))
    # Exhaust grille across the back of the roof.
    for x in (-.2,-.1,0,.1,.2):
        parts.append(box('Roof grille',(.06,.03,.34),(x,2.11,-.56),BLACK,0))
    # Sensor block on the roof (left) with a red lens, and a whip antenna at the back (right).
    parts += [box('Sensor block',(.26,.14,.3),(-.36,2.19,.02),BLACK,.02),
              box('Sensor lens',(.16,.05,.02),(-.36,2.2,.175),RED,0),
              rod('Antenna base',.06,(.38,2.12,-.72),.06,BLACK,'y',6),
              strut('Antenna',(.38,2.12,-.72),(.44,2.44,-.84),.018,BLACK,4)]
    return parts


def crusher_cannon():
    # Authored along +Z from the `barrel` pivot, in world coordinates.
    gy, gz = CRUSH_GUN
    octagon = lambda r: [(r*math.cos(a), gy+r*math.sin(a)) for a in [math.pi/8 + k*math.tau/8 for k in range(8)]]
    parts = [prism('Breech',octagon(.27),gz-.3,gz+.3,MACHINE,'xy',.02),
             rod('Breech sleeve',.2,(0,gy,gz+.38),.16,MACHINE,'z',10),
             rod('Plasma core',.075,(0,gy,gz+.96),1.32,RED,'z',8),
             prism('Emitter',octagon(.2),gz+1.56,gz+1.74,BLACK,'xy',.015),
             rod('Focus ring',.13,(0,gy,gz+1.76),.04,MPLATE,'z',10),
             rod('Plasma bore',.09,(0,gy,gz+1.785),.012,RED,'z',10)]
    for z in (.48,.76,1.04,1.32):
        parts += [rod('Coil',.155,(0,gy,gz+z),.14,BLACK,'z',12),
                  rod('Coil band',.165,(0,gy,gz+z),.04,MPLATE,'z',12)]
    for s in (-1,1):
        parts += [box('Accelerator rail',(.06,.16,1.3),(s*.19,gy,gz+.95),MPLATE,.01),
                  box('Emitter prong',(.06,.1,.26),(s*.15,gy,gz+1.77),MPLATE,.01)]
    for z in (.36,1.5):
        parts.append(box('Rail brace',(.44,.05,.08),(0,gy+.1,gz+z),MACHINE,0))
    return parts


def crusher():
    reset()
    for i, leg in enumerate(CRUSH_LEGS):
        crusher_leg(i, *leg)
    merge('Carapace', crusher_body())
    t = empty('turret', CRUSH_DECK)
    gy, gz = CRUSH_GUN
    b = empty('barrel', (0, gy-CRUSH_DECK[1], gz-CRUSH_DECK[2]), t)
    merge('Turret armor', crusher_turret(), t)
    merge('Plasma cannon', crusher_cannon(), b)
    empty('muzzle', (0,0,CRUSH_MOUTH), b)
    save('m_crusher')


# ---------------------------------------------------------------- Dron (m_drone)
# Cheap, fast machine hover drone shaped like an arrowhead: a faceted pod with a red eye,
# swept wings ending in thruster nacelles, twin canted tail fins, and a lift fan spinning in a
# duct on its back (the `ring` node). A chin ball under the nose carries the small laser.
DRONE_BOB = (0,1.1,0)
DRONE_FAN = (0,1.3,-.08)        # `ring` pivot: centre of the lift fan, spinning about +Y
DRONE_LENS = (0,.95,.69)        # tip of the laser emitter


def drone():
    reset()
    bob = empty('bob', DRONE_BOB)
    fx, fy, fz = DRONE_FAN
    lx, ly, lz = DRONE_LENS
    parts = [loft('Pod',[(.58,.07,1.05,1.13),(.44,.16,.98,1.2),(.2,.26,.94,1.27),(-.3,.27,.95,1.27),
                         (-.52,.17,1.0,1.21),(-.64,.09,1.05,1.15)],MACHINE,0),
             loft('Belly keel',[(.3,.12,.9,.98),(-.4,.12,.9,.98)],BLACK,0),
             # Lift fan duct on the back: raised collar, dark well, rim.
             rod('Fan duct',.25,(fx,1.29,fz),.08,MPLATE,'y',16),
             rod('Duct well',.21,(fx,1.333,fz),.01,BLACK,'y',16),
             torus('Duct rim',.225,.03,(fx,1.335,fz),MPLATE),
             # Sensor visor on the nose with the red eye, and the chin laser.
             tbox('Visor',(.24,.07,.12),(0,1.15,.44),BLACK,(-.3,0,0),.01),
             gem('Eye',(.07,.04,.04),(0,1.155,.5),RED),
             gem('Chin ball',(.11,.1,.11),(lx,ly,.32),BLACK),
             rod('Emitter',.028,(lx,ly,.5),.34,STEEL,'z',6),
             rod('Emitter coil',.05,(lx,ly,.46),.1,MPLATE,'z',8),
             rod('Laser lens',.04,(lx,ly,lz-.01),.02,RED,'z',8),
             # Rear thruster and a short antenna.
             rod('Main thruster',.08,(0,1.1,-.66),.1,BLACK,'z',10),
             rod('Thruster bell',.06,(0,1.1,-.72),.04,MPLATE,'z',10),
             strut('Antenna',(.1,1.25,-.38),(.13,1.46,-.52),.012,BLACK,4)]
    for s in (-1,1):
        wing = [(s*.2,.22),(s*.5,-.08),(s*.58,-.32),(s*.46,-.36),(s*.2,-.3)]
        parts += [prism('Wing',wing,1.06,1.11,MPLATE,'xz',.01),
                  box('Wing stripe',(.05,.012,.2),(s*.4,1.115,-.16),BLACK,0),
                  rod('Nacelle',.065,(s*.53,1.07,-.2),.42,MACHINE,'z',8),
                  rod('Nacelle band',.07,(s*.53,1.07,-.06),.04,BLACK,'z',8),
                  rod('Exhaust ring',.055,(s*.53,1.07,-.42),.03,BLACK,'z',8),
                  xform(cone('Nacelle nose',.065,.02,.12,(s*.53,1.07,.07),MPLATE,8),(math.pi/2,0,0),(s*.53,1.07,.07)),
                  rod('Hover jet',.06,(s*.53,1.0,-.2),.08,MPLATE,'y',8),
                  rod('Jet nozzle',.045,(s*.53,.955,-.2),.02,BLACK,'y',8),
                  xform(prism('Tail fin',[(-.38,1.2),(-.58,1.4),(-.66,1.4),(-.62,1.2)],s*.08-.012,s*.08+.012,MPLATE,'zy'),
                        (0,0,-s*.35),(s*.08,1.2,-.5))]
    merge('Drone shell', parts, bob)
    ring = empty('ring', (fx, fy-DRONE_BOB[1], fz), bob)
    fan = [rod('Fan hub',.05,(fx,1.35,fz),.035,RED,'y',8)]
    for k in range(4):
        a = k*math.tau/4
        fan.append(xform(tbox('Fan blade',(.06,.012,.15),(fx,1.345,fz+.11),MPLATE,(0,0,.3),0),(0,a,0),(fx,1.345,fz)))
    merge('Lift fan', fan, ring)
    empty('muzzle', (lx, ly-DRONE_BOB[1], lz), bob)
    save('m_drone')


def sphere_patch(name, c, r, a0, a1, e0, e1, tint, t=.08):
    # Plate of a spherical shell around c between azimuths a0..a1 (0 = +X, pi/2 = +Z) and elevations e0..e1.
    P = lambda a, e, rr: (c[0] + math.cos(a)*math.cos(e)*rr, c[1] + math.sin(e)*rr, c[2] + math.sin(a)*math.cos(e)*rr)
    outer = [P(a0,e0,r), P(a1,e0,r), P(a1,e1,r), P(a0,e1,r)]
    inner = [P(a0,e0,r-t), P(a1,e0,r-t), P(a1,e1,r-t), P(a0,e1,r-t)]
    faces = [(0,1,2,3), (7,6,5,4), (0,4,5,1), (1,5,6,2), (2,6,7,3), (3,7,4,0)]
    return solid(name, outer + inner, faces, tint)


def radome(c, r, tint, n=10, rings=(-.5,-.12,.28,.7,1.12,1.45), gap=.02):
    # Panelled ball: plates over a dark inner sphere, so the seams read as dark lines.
    out = [gem('Radome core', (r-.06,r-.06,r-.06), c, '#1a2028')]
    for i in range(n):
        a0, a1 = i*math.tau/n + gap, (i+1)*math.tau/n - gap
        for j in range(len(rings)-1):
            out.append(sphere_patch('Radome plate', c, r, a0, a1, rings[j]+gap, rings[j+1]-gap, tint, .07))
    return out + [rod('Radome cap', r*.18, (c[0], c[1]+r*.99, c[2]), .05, tint, 'y', 12)]


RADAR_DOME = (0,3.05,-.35), .55   # radome centre and radius, on top of the mast
RADAR_FINS = (0,2.42,-.35)        # `dish` pivot: the ring of sensor fins under the radome


def machine_radar():
    # Machine mobile radar: a low spider on the welder's four legs carrying a dark radome on a
    # telescopic mast. Under the ball a ring of three red-eyed sensor fins turns while it scans.
    reset()
    for i, leg in enumerate(WELD_LEGS):
        welder_leg(i, *leg)
    (cx, cy, cz), r = RADAR_DOME
    parts = [armor('Belly',.8,1.3,.42,.58,.1,(0,-.3),BLACK,0),
             loft('Hull',[(-1.05,.4,.5,1.0),(-.75,.5,.46,1.05),(.15,.5,.46,1.05),(.55,.4,.5,1.0)],MACHINE,0),
             loft('Carapace',[(-1.1,.4,.98,1.2),(-.8,.66,.97,1.36),(-.2,.74,.97,1.42),(.3,.7,.98,1.38),(.6,.48,1.0,1.26)],MACHINE,0),
             loft('Head',[(.5,.32,.7,1.2),(.78,.3,.74,1.16),(.95,.2,.8,1.06)],MPLATE,0),
             armor('Mast base',.7,.7,1.3,1.6,.25,(cx,cz),BLACK),
             rod('Mast',.13,(cx,2.0,cz),.9,MPLATE,'y',10),
             rod('Mast sleeve',.09,(cx,2.6,cz),.5,STEEL,'y',8),
             torus('Mast glow',.15,.03,(cx,2.3,cz),RED)]
    for x, y, e in ((-.09,1.0,.05), (.09,1.0,.05), (-.19,.94,.03), (.19,.94,.03)):
        parts.append(gem('Eye',(e,e*.8,e*.6),(x,y,.94),RED))
    for s in (-1,1):
        parts.append(strut('Mast stay',(s*.45,1.4,cz-.25),(cx,2.35,cz),.02,BLACK,4))
    merge('Radar spider', parts + radome(RADAR_DOME[0], r, MPLATE))
    fx, fy, fz = RADAR_FINS
    dish = empty('dish', RADAR_FINS)
    fins = [torus('Fin ring',.22,.04,RADAR_FINS,BLACK)]
    for k in range(3):
        a = k*math.tau/3
        fins += [tbox('Sensor fin',(.06,.16,.38),(fx+math.cos(a)*.38,fy,fz+math.sin(a)*.38),MPLATE,(0,math.pi/2-a,0),.01),
                 gem('Fin eye',(.05,.04,.05),(fx+math.cos(a)*.58,fy,fz+math.sin(a)*.58),RED)]
    merge('Sensor fins', fins, dish)
    save('m_radar')


def mobile_radar(machine=False):
    if machine:
        return machine_radar()
    reset()
    hull, edge, base, accent = OLIVE, LIGHT, DARK, BLUE
    objects = [box('Six wheel chassis', (1.9,.32,3.2), (0,.68,0), base, .08)]
    for s in (-1,1):
        for z in (-1.1,0,1.1):
            objects += [cyl('Tire',.44,.34,(s*.99,.44,z),base,'x'),
                        cyl('Hub',.22,.035,(s*1.18,.44,z),STEEL,'x')]
        objects.append(box('Recognition stripe',(.04,.18,1.65),(s*.97,1.13,-.45),accent,.008))
    objects += [armor('Cab',1.75,1.05,.84,1.77,.28,(0,1.05),hull),
                box('Windscreen',(1.35,.33,.06),(0,1.47,1.53),GLASS),
                box('Front bumper',(1.85,.18,.18),(0,.76,1.68),base),
                armor('Electronics housing',1.86,1.9,.84,1.45,.18,(0,-.48),edge),
                box('Signal panel',(.65,.16,.05),(0,1.23,-1.44),accent,.01),
                cyl('Mast base',.34,.18,(0,1.5,-.38),STEEL),
                cyl('Mast',.12,.68,(0,1.91,-.38),STEEL),
                box('Roof beacon',(.4,.1,.2),(0,1.85,1.05),accent,.015)]
    for x in (-.55,.55):
        for z in (-1.1,-.86,-.62):
            objects.append(box('Cooling vent',(.28,.025,.08),(x,1.46,z),base,.005))
    merge('Radar carrier', objects)
    dish = empty('dish',(0,2.27,-.38))
    reflector = bowl('Radar reflector',dish_profile(.96,.32),edge,.055,20)
    xform(reflector,(1.08,0,0),(0,0,0),(0,2.56,-.38))
    rotating = [reflector,
                beam('Reflector support',(0,2.27,-.38),(0,2.55,-.38),.13,STEEL),
                beam('Feed arm',(0,2.56,-.38),(0,2.88,.22),.07,STEEL),
                cyl('Receiver',.1,.16,(0,2.88,.22),accent,'z')]
    merge('Scanning antenna', rotating, dish)
    save('h_radar')


BUILDERS = {
    'h_radar': mobile_radar, 'm_radar': lambda: mobile_radar(True),
    'h_tank': tank, 'h_factory': factory,
    'h_rifle': lambda: infantry(), 'h_rocket': lambda: infantry(heavy=True),
    'm_sentinel': lambda: infantry(machine=True), 'h_arty': artillery,
    'h_harv': harvester, 'm_harv': bucket_excavator,
    'h_medic': lambda: infantry(medic=True), 'h_mech': repair_truck,
    'm_nanite': nanite, 'm_welder': welder,
    'm_drone': drone, 'm_crusher': crusher, 'm_siege': siege_spider,
    'h_turret': lambda: turret_building(), 'm_turret': lambda: turret_building(True),
    'h_hq': human_hq, 'm_hq': machine_hq,
    'h_power': lambda: power(), 'm_power': lambda: power(True),
    'h_refinery': lambda: refinery(), 'm_refinery': lambda: refinery(True),
    'h_barracks': lambda: barracks(), 'm_barracks': lambda: barracks(True),
    'm_factory': machine_factory, 'environment': environment, 'quarry': quarry,
    'prop_cash_crate': cash_crate,
    'h_engineer': lambda: infantry(engineer=True), 'm_engineer': machine_engineer,
    't_silo': lambda: tech('silo'), 't_ion': lambda: tech('ion'), 't_mammoth': lambda: tech('mammoth'),
    't_juggernaut': lambda: tech('juggernaut'),
    't_mine': lambda: tech('mine'),
    't_radar': lambda: tech('radar'),
    'h_mammoth': lambda: mammoth(BLUE), 'm_mammoth': lambda: mammoth(RED),
    'h_juggernaut': lambda: juggernaut(BLUE), 'm_juggernaut': lambda: juggernaut(RED),
}
if __name__ == '__main__':
    requested = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(BUILDERS)
    for id in requested:
        BUILDERS[id]()
