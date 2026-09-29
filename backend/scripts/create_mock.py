import json
import shutil
from pathlib import Path

def create_ppa_mock():
    base_dir = Path("backend/studies")
    src_dir = base_dir / "ELARABY_PTV_2021"
    dest_dir = base_dir / "ELARABY_PTV_2021_PPA_TEST"
    
    if not src_dir.exists():
        print("Source study not found.")
        return
        
    dest_dir.mkdir(exist_ok=True)
    
    # 1. Copy HBU
    shutil.copy(src_dir / "hbu.parquet", dest_dir / "hbu.parquet")
    
    # 2. Modify Study JSON
    with open(src_dir / "study.json", "r", encoding="utf-8") as f:
        study = json.load(f)
        
    study["meta"]["study_name"] = "ELARABY PTV 2021 (PPA Test)"
    
    # Add Bundle Type attribute
    bundle_attr = {
        "name": "Bundle Type",
        "attr_type": "Discrete",
        "level_count": 2,
        "is_sku": False,
        "is_size": False,
        "included": True,
        "visible": True,
        "level_names": ["Standalone", "Bundle"]
    }
    study["attributes"].append(bundle_attr)
    
    # Update products
    for p in study["products"]:
        if "+" in p["name"]:
            p["attributes"]["Bundle Type"] = "Bundle"
        else:
            p["attributes"]["Bundle Type"] = "Standalone"
            
    # Update group types if they exist
    if "group_types" in study:
        study["group_types"].append("Bundle Type")
    else:
        study["group_types"] = ["Brand", "Bundle Type"]
        
    with open(dest_dir / "study.json", "w", encoding="utf-8") as f:
        json.dump(study, f, indent=2)
        
    # 3. Update Index
    index_file = base_dir / "index.json"
    with open(index_file, "r", encoding="utf-8") as f:
        index = json.load(f)
        
    # Check if already exists
    exists = False
    for s in index["studies"]:
        if s["slug"] == "ELARABY_PTV_2021_PPA_TEST":
            exists = True
            break
            
    if not exists:
        import datetime
        index["studies"].append({
            "slug": "ELARABY_PTV_2021_PPA_TEST",
            "name": "ELARABY PTV 2021 (PPA Test)",
            "company": "ELARABY Group",
            "created_at": datetime.datetime.utcnow().isoformat() + "Z"
        })
        with open(index_file, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2)
            
    print("Mock study created successfully.")

if __name__ == "__main__":
    create_ppa_mock()
