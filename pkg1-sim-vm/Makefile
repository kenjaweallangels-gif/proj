# Команды разработки. Требуется bash, python3.12, (для sim) Godot 4.7 в PATH.
PY := .venv/bin/python
PKG := ../data/examples/op040_shelf_bench.json

.PHONY: venv test server sim sim-cli sim-test sim-shot replay-test godot-assets markers package-040 db-up db-down clean

venv:
	python3 -m venv .venv && .venv/bin/pip install -U pip wheel && .venv/bin/pip install -r requirements.txt

test:
	PYTHONPATH=core:. $(PY) -m pytest -q tests

server:
	PYTHONPATH=core:. $(PY) -m uvicorn --factory server.app:create_app --host 0.0.0.0 --port 8080 --reload

sim-cli:            ## ядро + синтетическая камера очков, вывод позы и шагов в консоль и по UDP
	PYTHONPATH=core:. AR_RIG=sim $(PY) -m arcore.app --package $(PKG) --frames 300

sim:                ## ядро + Godot-клиент (окно)
	PYTHONPATH=core:. AR_RIG=sim $(PY) -m arcore.app --package $(PKG) --frames 0 & \
	godot --path godot -- --package=$(abspath $(PKG)); kill %1

sim-test:           ## Godot без окна: загрузка пакета, GLB, сцены (печатает SELFTEST …)
	godot --headless --path godot -- --selftest --package=$(abspath $(PKG))

sim-shot:           ## снимок вида из «очков» без монитора (xvfb + llvmpipe): out/godot_step4.png
	mkdir -p out && xvfb-run -a -s "-screen 0 1600x900x24" godot --path godot --audio-driver Dummy -- \
	  --screenshot=$(abspath out)/godot_step4.png --step=4 --package=$(abspath $(PKG))

replay-test:        ## записать 150 кадров синтетики в EuRoC и прогнать ядро по записи (как будет с очками)
	PYTHONPATH=core:. $(PY) tools/record_euroc.py --rig sim --package $(PKG) --frames 150 --out out/rec_sim
	PYTHONPATH=core:. $(PY) -m arcore.app --rig replay --replay out/rec_sim --package $(PKG) --frames 150

markers:            ## листы меток для печати (PNG 300 dpi)
	PYTHONPATH=core:. $(PY) tools/make_markers.py --package $(PKG) --out out/markers

godot-assets:       ## текстуры меток, GLB-заглушки, условные листы КД (для Godot и демо)
	PYTHONPATH=core:. $(PY) tools/make_markers.py --package $(PKG) --out godot/textures/markers --raw
	PYTHONPATH=core:. $(PY) tools/make_markers.py --package ../data/examples/op070_bin_fuselage.json --out godot/textures/markers --raw
	PYTHONPATH=core:. $(PY) tools/make_fallback_glb.py $(PKG) ../data/examples/models/op040_shelf.glb
	$(PY) tools/make_kd_placeholder.py $(PKG) ../data/examples
	$(PY) tools/make_kd_placeholder.py ../data/examples/op070_bin_fuselage.json ../data/examples
	PYTHONPATH=core:. $(PY) tools/make_fallback_glb.py ../data/examples/op070_bin_fuselage.json ../data/examples/models/op070_bin_module.glb

package-040:        ## собрать пакет 040 из CSV технолога
	PYTHONPATH=core:. $(PY) tools/tp_csv_to_json.py ../data/examples/op040_csv out/op040.json

db-up:
	docker compose up -d db
db-down:
	docker compose down
clean:
	rm -rf out .pytest_cache **/__pycache__
