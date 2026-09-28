#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 build/ 测试副本：给所有 ES module import 与静态资源加上时间戳，绕过强缓存。"""
import os, re, time, shutil, sys

SRC = '/var/minis/workspace/xiuxian-worldbox'
DST = os.path.join(SRC, 'build')
V = str(int(time.time()))

def ensure(p):
    if not os.path.isdir(p):
        os.makedirs(p)

ensure(os.path.join(DST, 'js'))
ensure(os.path.join(DST, 'css'))

# 1) JS：重写 from './xxx.js' → './xxx.js?v=TS'
pat = re.compile(r"(from\s+['\"])(\.\/[^'\"]*?\.js)(['\"])")
n = 0
for f in sorted(os.listdir(os.path.join(SRC, 'js'))):
    if not f.endswith('.js'):
        continue
    src = open(os.path.join(SRC, 'js', f), encoding='utf-8').read()
    out = pat.sub(lambda m: m.group(1) + m.group(2) + '?v=' + V + m.group(3), src)
    open(os.path.join(DST, 'js', f), 'w', encoding='utf-8').write(out)
    n += 1

# 2) index.html：给入口与样式表加版本
html = open(os.path.join(SRC, 'index.html'), encoding='utf-8').read()
html = html.replace('js/main.js', 'js/main.js?v=' + V)
html = html.replace('css/style.css', 'css/style.css?v=' + V)
open(os.path.join(DST, 'index.html'), 'w', encoding='utf-8').write(html)

# 3) 样式
shutil.copy(os.path.join(SRC, 'css', 'style.css'), os.path.join(DST, 'css', 'style.css'))

print('BUILD_OK v=%s files=%d' % (V, n))
