#!/bin/sh

mv go.mod go.mod.bak
openapi-generator-cli generate -g go -i ../openapi-docs.yml --additional-properties packageName=main
rm -rf .openapi-generator README.md docs/ test/ go.mod git_push.sh
mv go.mod.bak go.mod
