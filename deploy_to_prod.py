import paramiko

host = "2.25.169.103"
port = 22
username = "root"
password = "2026ZoomPublic##"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, port, username, password, timeout=10)
    
    print("Fixing Dockerfile to use npm install instead of npm ci...")
    stdin, stdout, stderr = ssh.exec_command("sed -i 's/RUN npm ci/RUN npm install/g' /root/knowledgebot/Dockerfile")
    print(stdout.read().decode())
    
    print("Rebuilding Next.js Docker Container...")
    stdin, stdout, stderr = ssh.exec_command("cd /root/knowledgebot && docker compose up --build -d app")
    exit_status = stdout.channel.recv_exit_status()
    print("Build Output:", stdout.read().decode())
    print("Build Error:", stderr.read().decode())
    
    print("Verifying RAG Python microservice is running...")
    stdin, stdout, stderr = ssh.exec_command("ps aux | grep api_service.py")
    print(stdout.read().decode())

finally:
    ssh.close()
