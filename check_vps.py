import paramiko

host = "2.25.169.103"
port = 22
username = "root"
password = "2026ZoomPublic##"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, port, username, password, timeout=10)
    stdin, stdout, stderr = ssh.exec_command("cd /root/knowledgebot && git status && cat package.json | grep version")
    print(stdout.read().decode())
    print(stderr.read().decode())
finally:
    ssh.close()
