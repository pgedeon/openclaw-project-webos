#!/bin/bash
unset POSTGRES_HOST POSTGRES_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
nohup node task-server.js > /tmp/task-server.log 2>&1 &
sleep 3
tail -15 /tmp/task-server.log
