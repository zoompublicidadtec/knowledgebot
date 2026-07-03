import paramiko
import os

host = "2.25.169.103"
port = 22
username = "root"
password = "2026ZoomPublic##"

files_to_upload = [
    ("app/(app)/kanban/client-page.tsx", "/root/knowledgebot/app/(app)/kanban/client-page.tsx"),
]

commands_to_run = [
    "cd /root/knowledgebot && docker compose up --build -d app",
]

print(f"Connecting to {host}...")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, port, username, password, timeout=10)
    print("Connected successfully!")
    
    # SFTP upload
    sftp = ssh.open_sftp()
    for local_path, remote_path in files_to_upload:
        if os.path.exists(local_path):
            print(f"Uploading {local_path} to {remote_path}...")
            # Make sure remote dir exists
            remote_dir = os.path.dirname(remote_path)
            ssh.exec_command(f"mkdir -p '{remote_dir}'")
            sftp.put(local_path, remote_path)
        else:
            print(f"Warning: Local file {local_path} not found.")
    sftp.close()
    
    # Execute commands
    for cmd in commands_to_run:
        print(f"Executing: {cmd}")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        
        exit_status = stdout.channel.recv_exit_status()
        out = stdout.read().decode('utf-8', errors='ignore').strip()
        err = stderr.read().decode('utf-8', errors='ignore').strip()
        if out: print(f"STDOUT: {out}")
        if err: print(f"STDERR: {err}")
        print(f"Exit status: {exit_status}")
            
    print("Fix Deployment completed successfully!")
    
except Exception as e:
    print(f"Deployment failed: {e}")
finally:
    ssh.close()
