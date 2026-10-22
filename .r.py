import io
P = r'D:\Projects\tiger-music\tools\test\music.test.js'
t = io.open(P, encoding='utf-8').read()
marker = "test('wikiTitleFor \u89c4\u8303\u5316\u6761\u76ee\u540d'"
i1 = t.find(marker)
i2 = t.find(marker, i1 + 10)
assert i1 >= 0 and i2 > i1, (i1, i2)
# 截断到第二个出现的测试块前（即第一个块结束后空行）
t = t[:i1] + t[i2:]  # 把第二个块保留，第一个块删除
# 修复 externalLinks 编码断言（decodeURIComponent）
t = t.replace("assert.ok(l.rymAlbum.indexOf('\u53f6\u60e0\u7f8e') >= 0);", "assert.ok(decodeURIComponent(l.rymAlbum).indexOf('\u53f6\u60e0\u7f8e') >= 0);")
io.open(P, 'w', encoding='utf-8', newline='').write(t)
print('dedup ok, len', len(t))