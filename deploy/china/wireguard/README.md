# 两机 WireGuard 组网（agent机 82.156.14.48 ↔ web机 152.136.107.117）

目的：web→agent 的 /v3/* 调用与 agent→web 回调都带 Bearer 密钥，不走公网明文。
两台都有公网 IP，直连组网，无 NAT 穿透问题。网段选 10.8.0.0/24（避开两机现有
10.0.x / 172.21.x / docker 172.17-18.x）。

## 步骤（两台都执行 1）

```bash
sudo apt update && sudo apt install -y wireguard
```

## 2. 生成密钥（各机各自）

```bash
wg genkey | sudo tee /etc/wireguard/server.key | wg pubkey | sudo tee /etc/wireguard/server.pub
sudo chmod 600 /etc/wireguard/server.key
```

## 3. 配置

**agent机 /etc/wireguard/wg0.conf**（本机 10.8.0.1）：

```ini
[Interface]
Address = 10.8.0.1/24
ListenPort = 51820
PrivateKey = <agent机私钥>

[Peer]
# web机
PublicKey = <web机公钥>
AllowedIPs = 10.8.0.2/32
```

**web机 /etc/wireguard/wg0.conf**（本机 10.8.0.2）：

```ini
[Interface]
Address = 10.8.0.2/24
ListenPort = 51820
PrivateKey = <web机私钥>

[Peer]
# agent机
PublicKey = <agent机公钥>
Endpoint = 82.156.14.48:51820
AllowedIPs = 10.8.0.1/32
PersistentKeepalive = 25
```

## 4. 起网（两台各自）

```bash
sudo systemctl enable --now wg-quick@wg0
sudo wg show   # 互相 ping 10.8.0.1 / 10.8.0.2 验证
```

## 5. 安全组（腾讯云控制台）

- agent机：入站 22（你的IP）、**51820/udp 仅源 152.136.107.117**。不开 8001。
- web机：入站 22（你的IP）、80（0.0.0.0/0）、**51820/udp 仅源 82.156.14.48**。

## 验证清单

- [ ] web机 `curl http://10.8.0.1:8001/health` 通（agent 容器起后）
- [ ] agent机 `curl http://10.8.0.2:80/api/health` 通（web 容器起后）
- [ ] 公网 `curl http://82.156.14.48:8001/health` **不通**（安全组生效）
- [ ] `sudo wg show` 两端 latest handshake 持续更新
