#!/bin/sh
# 指定ポートを LISTEN しているプロセスだけを止める。
# pkill -f 'vite preview' のようなパターン一致は、同じ文字列を含む
# 自分自身のシェルまで巻きこんで殺してしまうので使わない。
port="$1"
[ -n "$port" ] || { echo "usage: kill_port.sh <port>" >&2; exit 2; }
pids=$(for f in /proc/[0-9]*/fd/*; do
  pid=${f#/proc/}; pid=${pid%%/*}
  [ "$pid" = "$$" ] && continue
  echo "$pid"
done 2>/dev/null | sort -u)
# /proc から LISTEN 中の inode を引く
hex=$(printf '%04X' "$port")
inodes=$(awk -v h=":$hex" 'NR>1 && $4=="0A" && index($2,h)>0 {print $10}' /proc/net/tcp /proc/net/tcp6 2>/dev/null | sort -u)
[ -n "$inodes" ] || exit 0
for pid in $pids; do
  for ino in $inodes; do
    if ls -l /proc/"$pid"/fd 2>/dev/null | grep -q "socket:\[$ino\]"; then
      kill -9 "$pid" 2>/dev/null && echo "killed $pid (port $port)"
      break
    fi
  done
done
exit 0
