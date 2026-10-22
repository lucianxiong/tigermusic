import io
t = io.open(r'D:\Projects\tiger-music\app\js\app.js', encoding='utf-8').read()
print('jamendo refs:', t.lower().count('jamendo'))
print('hint-card refs:', t.count('hint-card'))