#!/usr/bin/env bash
# Виртуальная веб-камера /dev/video10: симулятор очков публикует в неё кадры,
# и любое ПО (ядро, OpenCV, браузер) видит «камеру очков» как обычную UVC-камеру.
set -euo pipefail
sudo apt-get install -y v4l2loopback-dkms v4l2loopback-utils
sudo modprobe v4l2loopback devices=1 video_nr=10 card_label="AR-Glasses-Sim" exclusive_caps=1
echo "v4l2loopback" | sudo tee /etc/modules-load.d/v4l2loopback.conf >/dev/null
echo "options v4l2loopback devices=1 video_nr=10 card_label=AR-Glasses-Sim exclusive_caps=1" | sudo tee /etc/modprobe.d/v4l2loopback.conf >/dev/null
v4l2-ctl --list-devices
echo "OK: /dev/video10. Проверка: ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -pix_fmt yuv420p -f v4l2 /dev/video10"
echo "Внимание: при Secure Boot модуль DKMS нужно подписать (mokutil) или отключить Secure Boot в ВМ."
