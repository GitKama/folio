from PIL import Image, ImageDraw
from pathlib import Path
root = Path(__file__).resolve().parents[1]
(root / 'build').mkdir(exist_ok=True)
(root / 'public').mkdir(exist_ok=True)
im = Image.new('RGBA', (512, 512))
d = ImageDraw.Draw(im)
d.rounded_rectangle((12, 12, 500, 500), 108, fill='#1C3029')
d.rounded_rectangle((128, 86, 390, 434), 30, fill='#A7DFBE')
d.rounded_rectangle((103, 111, 355, 420), 22, fill='#F4F4E8')
d.line((151, 175, 303, 175), fill='#285C48', width=20)
d.line((151, 233, 283, 233), fill='#285C48', width=20)
d.line((151, 291, 240, 291), fill='#285C48', width=20)
d.ellipse((277, 336, 311, 370), fill='#73B895')
im.save(root / 'build' / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
im.save(root / 'public' / 'icon.png')
