# GitHub와 Render 업데이트

대상 저장소: `https://github.com/kjh090710/nnhss`

기존 저장소를 이미 PC에 clone했다면 새 파일을 저장소 폴더에 덮어쓴 뒤 다음 명령을 실행합니다.

```powershell
git add -A
git commit -m "Rebuild Hondibom with Node.js backend and new UX"
git push origin main
```

새 폴더에서 처음 업로드하는 경우:

```powershell
git init
git branch -M main
git add .
git commit -m "Rebuild Hondibom with Node.js backend and new UX"
git remote add origin https://github.com/kjh090710/nnhss.git
git push -u origin main
```

Render가 저장소의 `render.yaml`을 사용하고 있다면 push 후 자동 재배포됩니다.
