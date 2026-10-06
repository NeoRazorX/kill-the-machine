"""Rebuild all Blender assets: blender -b --python tools/build_models.py
Coordinates in helpers match the game: +Y up, +Z forward. Blender stores +Z up.
No external textures. Static parts are joined; animated pivots remain independent.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector
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


def beam(name, a, b, width, tint):
    a, b = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cube_add(size=1, location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (width, width, (b-a).length)
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return finish(obj, tint, min(.025, width*.15))


def tracked_chassis(machine=False):
    hull, edge, base = (MACHINE, MPLATE, BLACK) if machine else (OLIVE, LIGHT, DARK)
    objects = [armor('Armored chassis',2,3.05,.6,1.05,.25,(0,0),hull)]
    for s in (-1,1):
        objects.append(box('Track',(.62,.65,3.15),(s*1.02,.37,0),base,.12))
        objects.append(armor('Side armor',.68,3.05,.63,.87,.12,(s*1.03,0),edge))
        for z in (-.98,0,.98):
            objects.append(cyl('Wheel',.24,.06,(s*1.35,.38,z),STEEL,'x',8))
    return objects


def infantry(machine=False, heavy=False, medic=False):
    reset()
    id = 'm_sentinel' if machine else 'h_medic' if medic else 'h_rocket' if heavy else 'h_rifle'
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
               box('Chest plate',(.66 if machine else .49,.29,.1),(0,body_y+.08,.28 if machine else .23),edge),
               box('Identification',(.55 if machine else .35,.07,.03),(0,body_y+.14,.34 if machine else .295),accent,.005),
               box('Backpack',(.51,.52,.25),(0,body_y,-.35),WHITE if medic else base,.04)]
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
    objects += [armor('Command bunker',5.15,3.65,.3,2.24,.4,(0,.48),OLIVE),
                box('Roof',(4.8,.22,3.2),(0,2.35,.48),DARK,.07),
                armor('Control tower',1.6,1.75,.35,3.65,.22,(-1.56,-1.78),LIGHT),
                box('Tower glass',(1.39,.47,1.5),(-1.56,3.73,-1.78),GLASS,.08),
                box('Tower roof',(1.68,.16,1.8),(-1.56,4.05,-1.78),DARK),
                box('Door',(1.15,1.42,.06),(0,1.03,2.32),DARK),
                box('Door trim',(1.42,.12,.09),(0,1.79,2.35),BLUE)]
    for s in (-1,1):
        objects += [box('Window',(.85,.35,.055),(s*1.66,1.67,2.18),GLASS),
                    box('Window hood',(1,.12,.23),(s*1.66,1.92,2.22),LIGHT)]
    objects += [cyl('Antenna',.035,1.6,(2.35,3.2,-.8),STEEL,vertices=6),
                beam('Antenna cross',(2.0,3.7,-.8),(2.7,3.7,-.8),.035,STEEL)]
    merge('Headquarters',objects)
    dish = empty('dish',(1.35,2.5,-.78))
    objects = [cyl('Dish stand',.09,.6,(1.35,2.8,-.78),STEEL,vertices=8)]
    # Concave radar bowl with a closed back and raised receiver.
    center = Vector((1.35,3.32,-.78))
    verts = [tuple(center+Vector((0,-.18,0)))]
    verts += [tuple(center+Vector((math.sin(i*math.tau/12)*.77,.15,math.cos(i*math.tau/12)*.77))) for i in range(12)]
    verts += [tuple(center+Vector((0,-.26,0)))]
    faces = []
    for i in range(12):
        j=(i+1)%12
        faces += [(0,1+j,1+i),(13,1+i,1+j)]
    mesh=bpy.data.meshes.new('Radar bowl'); mesh.from_pydata([xyz(v) for v in verts],[],faces); mesh.update()
    obj=bpy.data.objects.new('Radar bowl',mesh);bpy.context.collection.objects.link(obj)
    objects += [finish(obj,'#b7c7c7'), beam('Receiver',(1.35,3.15,-.78),(1.35,3.78,-.78),.045,DARK),
                box('Receiver tip',(.15,.13,.15),(1.35,3.78,-.78),BLUE)]
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


def refinery(machine=False):
    reset()
    hull, edge, base, accent = (MACHINE,MPLATE,BLACK,RED) if machine else (OLIVE,LIGHT,DARK,BLUE)
    objects = platform(machine=machine)
    objects += [armor('Processing hall',3.2,3.35,.3,2.57,.3,(-1.05,-.73),hull),
                box('Roof vent',(1.8,.24,1.5),(-1.05,2.64,-.73),base,.05),
                box('Dock',(3.9,.13,1.65),(0,.37,1.94),base),
                box('Intake',(2.1,1.42,.1),(-.65,1.15,1.03),ORANGE if machine else DARK)]
    for i in range(6):
        objects.append(box('Loading stripe',(.29,.025,1.58),(-1.6+i*.64,.45,1.94),accent if machine else YELLOW,.005))
    if machine:
        objects += [cone('Smelter hopper',.43,1.03,1.28,(1.79,2.31,-1.09),MPLATE,8),
                    cyl('Furnace neck',.43,1.3,(1.79,1.02,-1.09),BLACK),
                    torus('Furnace rim',1.06,.08,(1.79,2.97,-1.09),ORANGE),
                    cyl('Slag tank',.63,1.6,(1.88,1.18,.72),BLACK),
                    torus('Slag band',.65,.055,(1.88,1.78,.72),RED)]
    else:
        objects += [cyl('Storage silo',.91,2.9,(1.86,1.79,-1.15),STEEL,vertices=12),
                    cone('Silo cap',.94,.12,.61,(1.86,3.55,-1.15),LIGHT,12),
                    torus('Silo band',.93,.045,(1.86,2.8,-1.15),BLUE),
                    cyl('Tank',.65,1.8,(1.89,1.23,.85),LIGHT)]
    for x in (-2.13,-1.35):
        objects += [cyl('Exhaust',.21,1.28,(x,3.29,-1.91),base,vertices=8),
                    torus('Exhaust lip',.23,.05,(x,3.92,-1.91),ORANGE if machine else STEEL)]
    objects.append(beam('Transfer pipe',(.22,1.85,-.56),(1.68,1.85,-.56),.21,STEEL))
    merge('Refinery',objects)
    save('m_refinery' if machine else 'h_refinery')


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
}
if __name__ == '__main__':
    requested = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(BUILDERS)
    for id in requested:
        BUILDERS[id]()
