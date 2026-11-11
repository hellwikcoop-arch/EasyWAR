# Рендер емблеми як металевого рельєфу: план + displacement із карти висот, метал із кольором джерела.
# Аргументи: <maps dir> <out dir> <frames> <size_px> [samples]
import bpy, sys, os, math
argv = sys.argv[sys.argv.index('--')+1:]
maps, out, frames, size = argv[0], argv[1], int(argv[2]), int(argv[3])
samples = int(argv[4]) if len(argv) > 4 else 48
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
col_img = bpy.data.images.load(os.path.abspath(f'{maps}/color.png'))
h_img = bpy.data.images.load(os.path.abspath(f'{maps}/height.png'))
a_img = bpy.data.images.load(os.path.abspath(f'{maps}/alpha.png'))
h_img.colorspace_settings.name = 'Non-Color'; a_img.colorspace_settings.name = 'Non-Color'
W, H = col_img.size; aspect = W / H
# площина
bpy.ops.mesh.primitive_plane_add(size=2)
ob = bpy.context.object; ob.name = 'emblem'
ob.scale = (aspect, 1, 1)
bpy.ops.object.transform_apply(scale=True)
# щільна сітка для рельєфу
sub = ob.modifiers.new('sub', 'SUBSURF'); sub.subdivision_type = 'SIMPLE'; sub.levels = 8; sub.render_levels = 8
tex = bpy.data.textures.new('h', 'IMAGE'); tex.image = h_img; tex.extension = 'EXTEND'
disp = ob.modifiers.new('disp', 'DISPLACE'); disp.texture = tex; disp.texture_coords = 'UV'
disp.strength = 0.12; disp.mid_level = 0.0; disp.direction = 'Z'
bpy.ops.object.shade_smooth()
# матеріал
mat = bpy.data.materials.new('gold'); mat.use_nodes = True
mat.blend_method = 'HASHED' if hasattr(mat, 'blend_method') else None
nt = mat.node_tree; nodes = nt.nodes; links = nt.links
bsdf = nodes['Principled BSDF']
tc = nodes.new('ShaderNodeTexImage'); tc.image = col_img
ta = nodes.new('ShaderNodeTexImage'); ta.image = a_img
th = nodes.new('ShaderNodeTexImage'); th.image = h_img
links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
links.new(ta.outputs['Color'], bsdf.inputs['Alpha'])
bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.5; bump.inputs['Distance'].default_value = 0.02
links.new(th.outputs['Color'], bump.inputs['Height']); links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Metallic'].default_value = 1.0
# шорсткість: світліші ділянки блискучіші
rr = nodes.new('ShaderNodeMapRange'); rr.inputs['From Min'].default_value = 0; rr.inputs['From Max'].default_value = 1
rr.inputs['To Min'].default_value = 0.38; rr.inputs['To Max'].default_value = 0.14
links.new(th.outputs['Color'], rr.inputs['Value']); links.new(rr.outputs['Result'], bsdf.inputs['Roughness'])
if 'Coat Weight' in bsdf.inputs: bsdf.inputs['Coat Weight'].default_value = 0.25
ob.data.materials.append(mat)
# камера (ортографічна, фронтальна)
# камера з перспективою: поворот читається як глибина, а не як зсув
cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 70; cam_d.sensor_width = 36
cam = bpy.data.objects.new('cam', cam_d); sc.collection.objects.link(cam)
cam.location = (0, 0, 2 * max(aspect, 1) * 1.02 * 70 / 36 + 0.12); sc.camera = cam
# світло: ключове тепле зверху-зліва, заповнююче холодне, контрове
def light(name, kind, loc, energy, color=(1,1,1), size=2):
    d = bpy.data.lights.new(name, kind); d.energy = energy; d.color = color
    if kind == 'AREA': d.size = size
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = (math.atan2(math.hypot(loc[0], loc[1]), loc[2]) , 0, math.atan2(loc[1], loc[0]) + math.pi/2)
    # навести на початок координат
    direction = -(o.location); rot = direction.to_track_quat('-Z', 'Y'); o.rotation_euler = rot.to_euler()
    return o
light('key', 'AREA', (-2.5, 3.0, 4.5), 1250, (1.0, 0.93, 0.8), 3)
light('fill', 'AREA', (3.5, -1.0, 3.5), 260, (0.75, 0.85, 1.0), 4)
light('rim', 'AREA', (0.5, -3.5, 2.5), 500, (1.0, 0.85, 0.6), 2)
# світ: холодний градієнт для відбиття в металі
sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True
wn = sc.world.node_tree.nodes; wl = sc.world.node_tree.links
bg = wn['Background']; bg.inputs['Strength'].default_value = 1.6
grad = wn.new('ShaderNodeTexGradient'); grad.gradient_type = 'LINEAR'
ramp = wn.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.02, 0.05, 0.12, 1); ramp.color_ramp.elements[1].color = (0.55, 0.65, 0.85, 1)
coord = wn.new('ShaderNodeTexCoord'); mp = wn.new('ShaderNodeMapping')
mp.inputs['Rotation'].default_value = (0, math.radians(90), 0)
wl.new(coord.outputs['Generated'], mp.inputs['Vector']); wl.new(mp.outputs['Vector'], grad.inputs['Vector'])
wl.new(grad.outputs['Fac'], ramp.inputs['Fac']); wl.new(ramp.outputs['Color'], bg.inputs['Color'])
# рендер
sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.use_denoising = True
sc.cycles.device = 'CPU'
sc.render.film_transparent = True
sc.render.resolution_x = size; sc.render.resolution_y = int(size / max(aspect, 1) * (1 if aspect >= 1 else 1/aspect)) if False else int(size / aspect) if aspect >= 1 else size
if aspect < 1: sc.render.resolution_x = int(size * aspect)
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'
for i in range(frames):
    t = (i / max(frames - 1, 1)) * 2 - 1 if frames > 1 else 0
    ob.rotation_euler = (math.radians(-7 * t), math.radians(30 * t), 0)
    sc.render.filepath = os.path.abspath(f'{out}/f{i:02d}.png')
    bpy.ops.render.render(write_still=True)
print('done', out)
