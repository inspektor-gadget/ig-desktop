.PHONY: igd igd-single-env

igd:
	npm --prefix frontend run build
	mkdir -p bin
	go build -tags production,withoutebpf -o bin/igd ./cmd/igd

igd-single-env:
	npm --prefix frontend run build:single-env
	mkdir -p bin
	go build -tags production,withoutebpf -o bin/igd-single-env ./cmd/igd
