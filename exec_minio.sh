#!/bin/sh

docker run -d -p 9000:9000 -p 9001:9001 \
  --name minio1 \
  -e "MINIO_ROOT_USER=minio" \
  -e "MINIO_ROOT_PASSWORD=minio123" \
  -v /mnt/data:/data \
  minio/minio server /data --console-address ":9001"