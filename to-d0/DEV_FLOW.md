# Daylist — Flow Map

## Page load

```
index.html loads
      │
      ▼
app.js runs top→bottom
      │
      ├─ CONFIG, odata(), api{} defined
      ├─ els{} = getElementById(...)  ⚠ null here = silent crash, nothing below runs
      ├─ render(), handlers defined
      ├─ click/keydown listeners attached
      ▼
loadTasks()
      │
      ├─ loading spinner ON
      ├─ await api.list() → GET /ToDo
      │        │
      │        ├─ fail ──────► showError() banner
      │        └─ ok → tasks = [...]
      ▼
render()
      │
      └─ loading spinner OFF
```

## Add task

```
type text → click "Add task" / Enter
      │
      ▼
handleAdd()
      │
      ├─ empty input? → stop (normal)
      ├─ disable button
      ├─ await api.create(title) → POST /ToDo
      │        │
      │        ├─ fail ──────► showError() banner
      │        └─ ok → tasks.push(newRow)
      ▼
render()  +  clear input  +  re-enable button
```

## Toggle / Edit / Delete (same shape, optimistic)

```
click checkbox / Edit / Delete
      │
      ▼
update local `tasks` array immediately
      │
      ▼
render()   ← UI updates instantly, before server replies
      │
      ▼
await api.setCompleted / rename / remove  →  PATCH or DELETE /ToDo(id)
      │
      ├─ ok    → done, nothing more happens
      └─ fail  → undo local change → render() again → showError() banner
```

## Where to look, by symptom

| Symptom | Check |
|---|---|
| Spinner never stops | Network tab: is GET `/ToDo` pending forever, or did it return? |
| Add button does nothing | Is it stuck `disabled`? → POST never resolved (Network tab) |
| Nothing at all works, no errors | Console: error thrown while building `els{}` — a DOM id mismatch |
| Checkbox/edit/delete flips back | Server rejected the PATCH/DELETE → read the banner text |
