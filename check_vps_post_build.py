import paramiko
import sys

# Change default encoding for printing on windows
sys.stdout.reconfigure(encoding='utf-8')

host = "2.25.169.103"
port = 22
username = "root"
password = "2026ZoomPublic##"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, port, username, password, timeout=10)
    
    print("Checking Docker status...")
    stdin, stdout, stderr = ssh.exec_command("docker ps | grep knowledgebot")
    print(stdout.read().decode('utf-8', errors='ignore'))
    
    print("Checking app logs...")
    stdin, stdout, stderr = ssh.exec_command("docker compose -f /root/knowledgebot/docker-compose.yml logs --tail 20 app")
    print(stdout.read().decode('utf-8', errors='ignore'))
    
    print("Restarting RAG API just in case...")
    ssh.exec_command("pkill -f api_service.py")
    ssh.exec_command("cd '/root/knowledgebot/Motor de Conocimiento' && mkdir -p logs && nohup .venv/bin/python api_service.py > logs/api_run.log 2>&1 &")
    
finally:
    ssh.close()
