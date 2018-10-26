# opentrons platform makefile
# https://github.com/Opentrons/opentrons

SHELL := /bin/bash

# add node_modules/.bin to PATH
PATH := $(shell yarn bin):$(PATH)

API_DIR := api
DISCOVERY_CLIENT_DIR := discovery-client
SHARED_DATA_DIR := shared-data
UPDATE_SERVER_DIR := update-server

# this may be set as an environment variable to select the version of
# python to run if pyenv is not available. it should always be set to
# point to a python3.6.
OT_PYTHON ?= python

# watch, coverage, and update snapshot variables for tests
watch ?= false
cover ?= true
updateSnapshot ?= false

ifeq ($(watch), true)
	cover := false
endif

# run at usage (=), not on makefile parse (:=)
usb_host = $(shell yarn run -s discovery find -i 169.254 fd00 -c "[fd00:0:cafe:fefe::1]")

# install all project dependencies
.PHONY: install
install: install-py install-js

.PHONY: install-py
install-py:
	$(OT_PYTHON) -m pip install pipenv==2018.10.9
	$(MAKE) -C $(API_DIR) install
	$(MAKE) -C $(UPDATE_SERVER_DIR) install

# front-end dependecies handled by yarn
.PHONY: install-js
install-js:
	yarn
	$(MAKE) -C $(SHARED_DATA_DIR)
	$(MAKE) -C $(DISCOVERY_CLIENT_DIR)

# uninstall all project dependencies
# TODO(mc, 2018-03-22): API uninstall via pipenv --rm in api/Makefile
.PHONY: uninstall
uninstall:
	shx rm -rf '**/node_modules'

# install flow typed definitions for all JS projects that use flow
# typedefs are commited, so only needs to be run when we want to update
.PHONY: install-types
install-types:
	flow-mono align-versions
	flow-mono install-types --overwrite --flowVersion=0.61.0
	flow-typed install --overwrite --flowVersion=0.61.0

.PHONY: push-api
push-api: export host = $(usb_host)
push-api:
	$(if $(host),@echo "Pushing to $(host)",$(error host variable required))
	$(MAKE) -C $(API_DIR) push
	$(MAKE) -C $(API_DIR) restart

.PHONY: api-local-container
api-local-container:
	docker build . \
		--no-cache \
		--build-arg base_image=resin/amd64-alpine-python:3.6-slim-20180123 \
		--build-arg running_on_pi="" \
		--build-arg data_mkdir_path_slash_if_none=/data/system

.PHONY: term
term: export host = $(usb_host)
term:
	$(if $(host),@echo "Connecting to $(host)",$(error host variable required))
	$(MAKE) -C $(API_DIR) term

# all tests
.PHONY: test
test: test-py test-js

# Use lerna to run test only if anything in update-server has changed
# `--scope @opentrons/update-server` tells lerna to use the package.json that
#   uses this name (e.g.: the one in update-server/otupdate)
# `--since` gives the name of the upstream branch to check against
# `-- ` (with the space after) tells lerna to execute everything after this
# `-C ..` is here because the scope causes the working directory to change to
#   where it finds the package.json specified by --scope, and the Makefile is
#   in the parent of that directory
.PHONY: test-py
test-py:
#	lerna exec --scope @opentrons/update-server --since origin/edge -- $(MAKE) -C .. test
	$(MAKE) -C api test

.PHONY: test-js
test-js:
	jest \
		--runInBand \
		--coverage=$(cover) \
		--watch=$(watch) \
		--updateSnapshot=$(updateSnapshot)

# lints and typechecks
.PHONY: lint
lint: lint-py lint-js lint-css

.PHONY: lint-py
lint-py:
	$(MAKE) -C $(API_DIR) lint
	$(MAKE) -C $(UPDATE_SERVER_DIR) lint

.PHONY: lint-js
lint-js:
	eslint '.*.js' '**/*.js'
	flow $(if $(CI),check,status)

.PHONY: lint-css
lint-css:
	stylelint '**/*.css'

# upload coverage reports
.PHONY: coverage
coverage:
	codecov

# TODO(mc, 2018-06-06): update publish call and echo note when lerna splits
# version bump and publish: https://github.com/lerna/lerna/issues/961
.PHONY: bump
bump:
	@echo "Bumping versions"
	@echo "(please ignore lerna mentioning 'publish'; publish is disabled)"
	lerna publish $(opts)
