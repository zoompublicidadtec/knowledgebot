import os

def convert_imports():
    agent_dir = "d:\\KNOWLEDGE ZOOM PUBLICIDAD\\lib\\agent"
    tools_dir = os.path.join(agent_dir, "tools")
    
    # Process files in agent_dir root
    for f in os.listdir(agent_dir):
        fpath = os.path.join(agent_dir, f)
        if os.path.isfile(fpath) and f.endswith('.ts'):
            print(f"Processing root agent file: {f}")
            with open(fpath, 'r', encoding='utf-8') as file:
                content = file.read()
            
            # Replace imports
            content = content.replace("@/lib/logger", "../logger")
            content = content.replace("@/lib/supabase/admin", "../supabase/admin")
            content = content.replace("@/lib/database.types", "../database.types")
            content = content.replace("@/lib/timezone", "../timezone")
            content = content.replace("@/lib/appointments", "../appointments")
            
            with open(fpath, 'w', encoding='utf-8') as file:
                file.write(content)
                
    # Process files in tools_dir
    for f in os.listdir(tools_dir):
        fpath = os.path.join(tools_dir, f)
        if os.path.isfile(fpath) and f.endswith('.ts'):
            print(f"Processing tool file: {f}")
            with open(fpath, 'r', encoding='utf-8') as file:
                content = file.read()
            
            # Replace imports
            content = content.replace("@/lib/logger", "../../logger")
            content = content.replace("@/lib/supabase/admin", "../../supabase/admin")
            content = content.replace("@/lib/database.types", "../../database.types")
            content = content.replace("@/lib/timezone", "../../timezone")
            content = content.replace("@/lib/appointments", "../../appointments")
            
            with open(fpath, 'w', encoding='utf-8') as file:
                file.write(content)

if __name__ == "__main__":
    convert_imports()
