SHELL := /bin/bash
VENV := .venv
PYTHON := $(VENV)/bin/python
PIP := $(VENV)/bin/pip
NPM ?= npm

.PHONY: setup native analysis test test-python test-web web-build serve demo clean-demo standalone-mcs standalone-mcs-secure standalone-mcs-vulnerable

setup:
	./scripts/bootstrap.sh

native:
	$(MAKE) -C bin/aviation all

analysis: native
	bash scripts/build_aviation_analysis.sh

test-python:
	$(PYTHON) -m unittest discover -s tests -v

test-web:
	$(NPM) --prefix web test -- --run

test: test-python test-web

web-build:
	$(NPM) --prefix web run build

serve:
	$(PYTHON) -m aviation_demo.server

demo: analysis web-build serve

# Independent MCS Analyzer + Schnauzer application. This is intentionally
# separate from the ALBATROS flight-demo server on port 5000.
standalone-mcs: standalone-mcs-secure

standalone-mcs-secure: native
	$(PYTHON) scripts/run_standalone_mcs.py --profile secure

standalone-mcs-vulnerable: native
	$(PYTHON) scripts/run_standalone_mcs.py --profile vulnerable

clean-demo:
	$(MAKE) -C bin/aviation clean
	rm -rf web/dist web/public/analysis/*.json
