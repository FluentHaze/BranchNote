from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
root=Path(__file__).parent
board=Image.new("RGB",(1536,970),"#eeedf1")
draw=ImageDraw.Draw(board)
font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",22)
small=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",15)
notes=[
("A  轻量清单",["白 / 浅灰 / 钴蓝","项目侧栏 + 清单","去掉逐行提交按钮","选择后统一提交"]),
("B  专注工作台",["石墨灰 / 蓝紫","固定 MR 提交区","所选分支清楚可见","移动端收到底栏"]),
("C  项目笔记",["白 / 紫灰","顶部项目导航","功能卡片 + 两阶段状态","移动端自然变单列"])
]
for i,(title,lines) in enumerate(notes):
    x=16+i*512
    draw.rounded_rectangle((x,16,x+496,950),radius=14,fill="white")
    draw.text((x+20,32),title,font=font,fill="#29272e")
    desktop=Image.open(root/f"dir-{i+1}-desktop.png").convert("RGB")
    desktop.thumbnail((480,300),Image.Resampling.LANCZOS)
    board.paste(desktop,(x+8,82))
    mobile=Image.open(root/f"dir-{i+1}-mobile.png").convert("RGB")
    mobile.thumbnail((218,472),Image.Resampling.LANCZOS)
    board.paste(mobile,(x+20,418))
    draw.text((x+260,430),"移动端",font=font,fill="#29272e")
    for j,line in enumerate(lines):
        draw.text((x+260,490+j*38),line,font=small,fill="#68636e")
    draw.text((x+20,914),"演示数据 / 可点击交互原型",font=small,fill="#77717d")
board.save(root/"comparison.png")
