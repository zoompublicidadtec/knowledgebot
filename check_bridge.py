import paramiko

host = "2.25.169.103"
port = 22
username = "root"
password = "2026ZoomPublic##"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, port, username, password, timeout=10)
    
    print("--- CURL TO WA-BRIDGE ---")
    stdin, stdout, stderr = ssh.exec_command("curl -s http://localhost:3004/api/status || echo 'Failed to connect'")
    print(stdout.read().decode('utf-8', errors='ignore'))
    
    print("\n--- WA-BRIDGE LOGS ---")
    stdin, stdout, stderr = ssh.exec_command("docker logs --tail 100 knowledgebot-wa-bridge")
    print(stdout.read().decode('utf-8', errors='ignore'))
    print(stderr.read().decode('utf-8', errors='ignore'))
    
finally:
    ssh.close()
