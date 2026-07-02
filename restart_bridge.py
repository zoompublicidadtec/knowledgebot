import paramiko

host = "2.25.169.103"
port = 22
username = "root"
password = "2026ZoomPublic##"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, port, username, password, timeout=10)
    
    print("Restarting WhatsApp Bridge...")
    stdin, stdout, stderr = ssh.exec_command("docker restart knowledgebot-wa-bridge")
    print(stdout.read().decode('utf-8'))
    
    print("Waiting 10 seconds for bridge to boot...")
    import time
    time.sleep(10)
    
    print("Checking WA Bridge logs...")
    stdin, stdout, stderr = ssh.exec_command("docker logs --tail 20 knowledgebot-wa-bridge")
    print(stdout.read().decode('utf-8'))
    
finally:
    ssh.close()
