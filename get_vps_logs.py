import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8')

host = "2.25.169.103"
port = 22
username = "root"
password = "2026ZoomPublic##"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, port, username, password, timeout=10)
    
    print("--- LOGS WHATSAPP BRIDGE ---")
    stdin, stdout, stderr = ssh.exec_command("docker logs --tail 50 knowledgebot-wa-bridge")
    print(stdout.read().decode('utf-8', errors='ignore'))
    
    print("\n--- LOGS NEXT.JS APP ---")
    stdin, stdout, stderr = ssh.exec_command("docker logs --tail 100 knowledgebot-app")
    print(stdout.read().decode('utf-8', errors='ignore'))

finally:
    ssh.close()
