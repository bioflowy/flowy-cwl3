#!/bin/sh
SCRIPT_PATH=$(readlink -f "$0")

# スクリプトのディレクトリパスを取得
SCRIPT_DIR=$(dirname "$SCRIPT_PATH")

pushd flowydeamon
./flowydeamon &> flowydeamon.log &
popd

mkdir work
cd work
VERSION=${VERSION:-"v1.2"}

# Which commit of the standard's repo to use
# Defaults to the last commit of the 1.2.1_proposed branch
GIT_TARGET=${GIT_TARGET:-"1.2.1_proposed"}
REPO=cwl-v1.2
wget "https://github.com/common-workflow-language/${REPO}/archive/${GIT_TARGET}.tar.gz"

tar -xzf "${GIT_TARGET}.tar.gz"


cd "${REPO}-${GIT_TARGET}"

cwltest --test conformance_tests.yaml --badgedir badge --tool ../flowycwl 2>&1 | tee conformance_test.log

killall flowydeamon