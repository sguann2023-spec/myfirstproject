import os
import shutil
import requests
import base64
import hmac
import hashlib
import json
from datetime import datetime, timezone
import argparse
from typing import List, Dict, Any
import uuid
import uuid

# 阿里云OSS配置
OSS_CONFIG = {
    'bucket_name': 'oss-hangzhou-mp4',
    'endpoint': 'https://oss-cn-hangzhou.aliyuncs.com',
    'host': 'oss-hangzhou-mp4.oss-cn-hangzhou.aliyuncs.com',
    'public_endpoint': 'https://player.install-ai-guider.top'
}

# API配置
API_CONFIG = {
    'base_url': 'https://open.vectcut.com',
    'create_preset_path': '/cut_jianying/dev/preset/create_preset',
    'update_preset_path': '/cut_jianying/dev/preset/update_preset'
}


def extract_user_id_from_token(jwt_token):
    """从JWT令牌中提取用户ID，使用base64解码而不依赖jwt库"""
    try:
        # JWT格式: header.payload.signature
        parts = jwt_token.split('.')
        if len(parts) != 3:
            print("错误: JWT令牌格式不正确")
            return None
        
        # 解码payload部分
        payload = parts[1]
        # 处理base64 padding
        payload += '=' * (4 - len(payload) % 4) if len(payload) % 4 != 0 else ''
        
        try:
            decoded_payload = base64.urlsafe_b64decode(payload).decode('utf-8')
            payload_data = json.loads(decoded_payload)
            # 从payload中获取用户ID (sub字段)
            return payload_data.get('sub')
        except Exception as e:
            print(f"解析JWT payload失败: {str(e)}")
            return None
    except Exception as e:
        print(f"解析令牌失败: {str(e)}")
        return None


# ---------------------------------------------------
# OSS 签名和上传函数
# ---------------------------------------------------

def generate_oss_signature(access_key_id, access_key_secret, method, content_type, resource, security_token=None, content_md5=""):
    """
    生成阿里云OSS RESTful API的签名，支持STS SecurityToken
    """
    date = datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')
    
    # --- FIX: 当使用STS时，必须将 x-oss-security-token 添加到 CanonicalizedOSSHeaders 并包含在 StringToSign 中 ---
    canonicalized_oss_headers = ""
    if security_token:
        # 格式为 x-oss-header-name:value\n
        canonicalized_oss_headers = f"x-oss-security-token:{security_token}\n"
    # ------------------------------------------------------------------------------------------------------------------

    # 构建待签名字符串
    # StringToSign = HTTP-Verb + "\n" + Content-MD5 + "\n" + Content-Type + "\n" + Date + "\n" + CanonicalizedOSSHeaders + CanonicalizedResource
    string_to_sign = (
        f"{method}\n"
        f"{content_md5}\n"
        f"{content_type}\n"
        f"{date}\n"
        f"{canonicalized_oss_headers}"  # 新增 Canonicalized OSS Headers
        f"/{resource}"
    )
    
    # 构造 HMAC-SHA1 签名
    h = hmac.new(
        access_key_secret.encode('utf-8'),
        string_to_sign.encode('utf-8'),
        hashlib.sha1
    )
    signature = base64.b64encode(h.digest()).decode('utf-8')
    authorization = f"OSS {access_key_id}:{signature}"
    
    # 返回授权头、日期，以及 SecurityToken
    return authorization, date, security_token

def check_object_exists(object_name, access_key_id, access_key_secret):
    """
    检查OSS对象是否存在
    """
    bucket_name = OSS_CONFIG['bucket_name']
    endpoint_host = OSS_CONFIG['endpoint'].replace('https://', '').replace('http://', '').strip('/')
    host = f"{bucket_name}.{endpoint_host}"
    resource = f"{bucket_name}/{object_name}"
    authorization, date, _ = generate_oss_signature(
        access_key_id, access_key_secret, "HEAD", "", resource
    )
    url = f"https://{host}/{object_name}"
    public_endpoint = OSS_CONFIG.get('public_endpoint', '').rstrip('/')
    headers = {
        'Host': host,
        'Date': date,
        'Authorization': authorization
    }
    response = requests.head(url, headers=headers)
    return response.status_code == 200

def create_preset(jwt_token):
    """
    调用API创建预设，获取预设ID和OSS上传所需的STS临时凭证。
    
    Returns:
        dict: 包含 preset_id, AccessKeyId, AccessKeySecret, SecurityToken, Expiration 的字典，失败则返回None
    """
    url = f"{API_CONFIG['base_url']}{API_CONFIG['create_preset_path']}"
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {jwt_token}'
    }
    
    try:
        print("正在请求创建预设ID并获取STS凭证...")
        response = requests.post(url, headers=headers, json={})
        if response.status_code == 200:
            data = response.json()
            if data.get('success') and data.get('data'):
                response_data = data.get('data', {})
                # 检查返回的数据是否完整
                required_keys = ['preset_id', 'AccessKeyId', 'AccessKeySecret', 'SecurityToken', 'Expiration']
                if all(key in response_data for key in required_keys):
                    print(f"创建预设ID成功: {response_data['preset_id']}，STS凭证获取成功。")
                    return response_data
                else:
                    print(f"API响应数据不完整: {response_data}")
                    return None
            else:
                print(f"创建预设失败: {data.get('message')}")
                return None
        else:
            print(f"创建预设请求失败: {response.status_code} {response.text}")
            return None
    except Exception as e:
        print(f"创建预设异常: {str(e)}")
        return None

def update_preset(preset_id, jwt_token, name, url, materials_url, image_url, description="", tags=None):
    """
    调用API更新预设信息
    """
    update_url = f"{API_CONFIG['base_url']}{API_CONFIG['update_preset_path']}/{preset_id}"
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {jwt_token}'
    }
    payload = {
        'name': name,
        'url': url,
        'materials_url': materials_url,
        'image_url': image_url,
        'description': description,
        'tags': tags
    }
    
    try:
        response = requests.put(update_url, headers=headers, json=payload)
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                return True
            else:
                print(f"更新预设失败: {data.get('message')}")
                return False
        else:
            print(f"更新预设请求失败: {response.status_code} {response.text}")
            return False
    except Exception as e:
        print(f"更新预设异常: {str(e)}")
        return False

def upload_file_to_oss(local_file, object_name, access_key_id, access_key_secret, security_token, content_type, type=None, region=None, bucket=None, endpoint=None):
    """
    上传单个文件到OSS或TOS，使用STS临时凭证或火山云AK
    :param type: 存储类型，"VOLC" 表示火山云TOS
    :param region: 区域
    :param bucket: 桶名
    :param endpoint: 终端节点

    """
    # 判断是否为火山云TOS上传
    if type == "VOLC":
        import tos
        if not os.path.exists(local_file):
            print(f"错误: 本地文件不存在: {local_file}")
            return None
        try:
            client = tos.TosClientV2(
                access_key_id,
                access_key_secret,
                endpoint,
                region
            )
            resp = client.put_object_from_file(
                bucket,
                object_name,
                local_file
            )
            public_endpoint = OSS_CONFIG.get('public_endpoint', '').rstrip('/') 
            url = f"{public_endpoint}/{object_name}" if public_endpoint else f"https://{bucket}.{endpoint}/{object_name}"
            # 可选：上传后删除本地文件
            try:
                os.remove(local_file)
            except OSError as e:
                print(f"临时文件清理警告：{str(e)}")
            return url
        except Exception as e:
            print(f"火山TOS上传失败：{str(e)}")
            return None

    # 原OSS上传逻辑
    if not os.path.isfile(local_file):
        print(f"错误: 本地文件不存在: {local_file}")
        return None
    
    bucket_name = OSS_CONFIG['bucket_name']
    endpoint_host = OSS_CONFIG['endpoint'].replace('https://', '').replace('http://', '').strip('/')
    host = f"{bucket_name}.{endpoint_host}"
    resource = f"{bucket_name}/{object_name}"
    
    # 1. 生成签名 (包含 SecurityToken)
    authorization, date, token = generate_oss_signature(
        access_key_id, access_key_secret, "PUT", content_type, resource, security_token
    )
    url = f"https://{host}/{object_name}"
    public_endpoint = OSS_CONFIG.get('public_endpoint', '').rstrip('/')
    file_size = os.path.getsize(local_file)
    
    # 2. 构造请求头，添加 x-oss-security-token
    headers = {
        'Host': host,
        'Date': date,
        'Content-Type': content_type,
        'Content-Length': str(file_size),
        'Authorization': authorization,
    }
    # 只有当 SecurityToken 存在时才添加这个头
    if token:
        headers['x-oss-security-token'] = token
    
    print(f"开始上传文件到OSS: {object_name}")
    try:
        with open(local_file, 'rb') as f:
            response = requests.put(url, headers=headers, data=f)
        
        if response.status_code == 200:
            oss_url = f"{public_endpoint}/{object_name}" if public_endpoint else url
            print(f"上传成功: {oss_url}")
            return oss_url
        else:
            req_id = response.headers.get('x-oss-request-id') or response.headers.get('x-tos-request-id')
            print(f"上传失败: status={response.status_code} request_id={req_id} body={response.text}")
            return None
    except Exception as e:
        print(f"上传文件异常: {str(e)}")
        return None
        
def upload_material_json_to_oss(json_file_path: str, user_id: str, preset_id: str, akid: str, aks: str, token: str, type=None, region=None, bucket=None, endpoint=None):
    """
    将生成的素材JSON文件上传到OSS。
    """
    if not os.path.exists(json_file_path):
        print(f"❌ 错误: 待上传的素材JSON文件不存在: {json_file_path}")
        return None
        
    object_name = f"preset/{user_id}/{preset_id}/materials.json"
    print(f"开始上传素材列表JSON文件到: {object_name}")

    json_url = upload_file_to_oss(
        json_file_path,
        object_name,
        akid,
        aks,
        token,
        "application/json",
        type,
        region,
        bucket,
        endpoint
    )
    return json_url

def resolve_preset_placeholder_path(local_path: str, local_folder: str) -> str:
    """
    将形如 '##_presetpath_placeholder_..._##/Resources/xxx' 的占位符路径，
    映射为以 local_folder 截到 '/Combination' 为根的实际路径。
    """
    try:
        if not local_path:
            return local_path
        # 原路径存在则直接返回
        if os.path.exists(local_path):
            return local_path

        # 仅处理包含 '/Resources/' 的占位符路径
        if isinstance(local_path, str) and '/Resources/' in local_path:
            comb_idx = local_folder.rfind('/Combination')
            if comb_idx != -1:
                # 用 local_folder 到 Combination 的路径作为根
                preset_root = local_folder[:comb_idx + len('/Combination')]
                # 取占位符后的 '/Resources/...'
                resources_tail = local_path[local_path.find('/Resources/'):]
                candidate_path = os.path.join(preset_root, resources_tail.lstrip('/'))
                if os.path.exists(candidate_path):
                    return candidate_path

        # 解析失败则回退原值
        return local_path
    except Exception:
        return local_path

def upload_folder_zip_to_oss(local_folder, jwt_token, description=None, name=None, tags=None, material_json_path=None):
    """
    将本地文件夹压缩为zip并上传到OSS的 preset/uid/preset_id/ 目录下，使用STS凭证

    Args:
        local_folder: 本地文件夹路径
        jwt_token: JWT令牌，用于API认证和提取用户ID
        description: 预设描述，默认为空
        name: 预设名称，默认为空（将使用文件夹名称）
        tags: 预设标签，默认为空

    Returns:
        dict: 包含上传结果的字典，成功时包含preset_id, url, image_url等信息，失败时为None
    """
    if not local_folder or not os.path.isdir(local_folder):
        print(f"错误: 本地文件夹不存在或不是目录: {local_folder}")
        return None
    
    # 从JWT令牌中提取用户ID
    user_id = extract_user_id_from_token(jwt_token)
    if not user_id:
        print("错误: 无法从JWT令牌中提取用户ID")
        return None
    
    print(f"从JWT令牌中提取的用户ID: {user_id}")

    # 1. 创建预设ID并获取STS临时凭证
    print("步骤1: 创建预设ID并获取STS临时凭证")
    result_data = create_preset(jwt_token)
    
    if not result_data:
        print("创建预设ID或获取凭证失败，终止上传")
        return None
    
    # 解包凭证和 ID
    preset_id = result_data['preset_id']
    akid = result_data['AccessKeyId']
    aks = result_data['AccessKeySecret']
    token = result_data['SecurityToken']
    type = result_data['type']
    region = result_data['region']
    bucket = result_data['bucket']
    endpoint = result_data['endpoint']

    print(f"成功创建预设ID: {preset_id}")

    folder_name = os.path.basename(os.path.abspath(local_folder))
    tmp_dir = os.path.join(os.getcwd(), "./tmp_upload")
    os.makedirs(tmp_dir, exist_ok=True)

    # --- 新增逻辑：处理素材 JSON 文件 ---
    material_json_to_upload = material_json_path

    if not material_json_to_upload:
        # 如果未指定，则自动扫描并生成
        temp_json_path = os.path.join(tmp_dir, f"{preset_id}_scanned_materials.json")
        print(f"步骤1.5: 未指定素材JSON文件，开始自动扫描并生成到 {temp_json_path}")
        if scan_and_save_materials(local_folder, temp_json_path) == 0:
            material_json_to_upload = temp_json_path
        else:
            print("警告: 自动扫描素材JSON失败，将跳过上传素材元数据。")

    # 创建一个临时目录来存放修改后的内容
    temp_processing_folder = os.path.join(tmp_dir, f"{folder_name}_processing_{preset_id}")
    if os.path.exists(temp_processing_folder):
        shutil.rmtree(temp_processing_folder)
    
    print(f"步骤2.1: 复制文件夹到临时目录进行处理: {temp_processing_folder}")
    shutil.copytree(local_folder, temp_processing_folder)

    # --- 新增逻辑：处理 draft_content.json ---
    draft_content_path = os.path.join(temp_processing_folder, 'preset_draft', 'draft_content.json')
    
    if not os.path.exists(draft_content_path):
        print(f"警告: 在预设路径中未找到 'preset_draft/draft_content.json'。")
    else:
        print("步骤2.2: 处理素材并上传到OSS")
        try:
            with open(draft_content_path, 'r', encoding='utf-8') as f:
                draft_content = json.load(f)

            modified = False
            
            # 处理音频（占位符解析）
            try:
                drafts_list = draft_content.get('materials', {}).get('drafts', [])
                audios = []
                for d in drafts_list:
                    alist = d.get('draft', {}).get('materials', {}).get('audios', [])
                    if isinstance(alist, list):
                        audios.extend(alist)
                for audio in audios:
                    local_path = audio.get('path')
                    real_local_path = resolve_preset_placeholder_path(local_path, local_folder)

                    if real_local_path and os.path.exists(real_local_path):
                        filename = os.path.basename(real_local_path)
                        object_name = f"preset/{user_id}/{preset_id}/{filename}"
                        content_type = 'audio/mpeg'
                        remote_url = upload_file_to_oss(real_local_path, object_name, akid, aks, token, content_type, type, region, bucket, endpoint)
                        if remote_url:
                            audio['remote_url'] = remote_url
                            ext = os.path.splitext(filename)[1]
                            random_material_name = f"{uuid.uuid4().hex}{ext}"
                            random_name = f"{uuid.uuid4().hex}{ext}"
                            audio['material_name'] = random_material_name
                            audio['name'] = random_name
                            modified = True
            except (KeyError, IndexError, TypeError):
                print("信息: 在 draft_content.json 中未找到或无法处理 'audios'。")

            # 处理视频（占位符解析）
            try:
                drafts_list = draft_content.get('materials', {}).get('drafts', [])
                videos = []
                for d in drafts_list:
                    vlist = d.get('draft', {}).get('materials', {}).get('videos', [])
                    if isinstance(vlist, list):
                        videos.extend(vlist)
                for video in videos:
                    local_path = video.get('path')
                    real_local_path = resolve_preset_placeholder_path(local_path, local_folder)

                    if real_local_path and os.path.exists(real_local_path):
                        filename = os.path.basename(real_local_path)
                        object_name = f"preset/{user_id}/{preset_id}/{filename}"
                        content_type = 'video/mp4'
                        remote_url = upload_file_to_oss(real_local_path, object_name, akid, aks, token, content_type, type, region, bucket, endpoint)
                        if remote_url:
                            video['remote_url'] = remote_url
                            ext = os.path.splitext(filename)[1]
                            random_material_name = f"{uuid.uuid4().hex}{ext}"
                            random_name = f"{uuid.uuid4().hex}{ext}"
                            video['material_name'] = random_material_name
                            video['name'] = random_name
                            modified = True
            except (KeyError, IndexError, TypeError):
                print("信息: 在 draft_content.json 中未找到或无法处理 'videos'。")

            if modified:
                with open(draft_content_path, 'w', encoding='utf-8') as f:
                    json.dump(draft_content, f, ensure_ascii=False, indent=4)
                print("draft_content.json 已更新，并添加了素材的远程URL。")

        except Exception as e:
            print(f"处理 draft_content.json 时发生错误: {e}")
    # --- 结束新增逻辑 ---

    # 2. 生成本地zip路径并压缩
    base_name = os.path.join(tmp_dir, folder_name)
    zip_path = f"{base_name}.zip"
    if os.path.exists(zip_path):
        os.remove(zip_path)

    print(f"步骤2.3: 压缩处理后的文件夹为zip: {temp_processing_folder} -> {zip_path}")
    shutil.make_archive(base_name, 'zip', temp_processing_folder)
    print(f"压缩完成: {zip_path}")
    
    # 清理临时处理文件夹
    if os.path.exists(temp_processing_folder):
        shutil.rmtree(temp_processing_folder)
        print(f"已删除临时处理文件夹: {temp_processing_folder}")

    # 3. 上传zip文件
    # OSS对象名：preset/uid/preset_id/preset_id.zip
    object_name = f"preset/{user_id}/{preset_id}/{preset_id}.zip"
    print(f"步骤3: 上传zip文件到 {object_name}")
    
    # 使用STS临时凭证上传
    zip_url = upload_file_to_oss(
        zip_path, 
        object_name, 
        akid,             # STS Access Key ID
        aks,              # STS Access Key Secret
        token,            # STS Security Token
        "application/zip",
        type,
        region,
        bucket,
        endpoint
    )
    
    # 删除临时zip文件
    if os.path.exists(zip_path):
        os.remove(zip_path)
        print(f"已删除临时zip文件: {zip_path}")
    
    if not zip_url:
        print("上传zip文件失败，终止流程")
        return None
    
    material_json_oss_url = None
    if material_json_to_upload:
        material_json_oss_url = upload_material_json_to_oss(
            material_json_to_upload, user_id, preset_id, akid, aks, token, type, region, bucket, endpoint
        )

    # 4. 查找并上传预设图片
    print("步骤4: 查找并上传预设图片")
    image_path = os.path.join(local_folder, f"{folder_name}.jpeg")
    if not os.path.exists(image_path):
        image_path = os.path.join(local_folder, f"{folder_name}.jpg")
    
    image_url = None
    if not os.path.exists(image_path):
        print(f"警告: 未找到预设图片 {folder_name}.jpeg 或 {folder_name}.jpg")
    else:
        # 上传图片
        image_object_name = f"preset/{user_id}/{preset_id}/{preset_id}.jpeg"
        # 使用STS临时凭证上传
        image_url = upload_file_to_oss(
            image_path, 
            image_object_name, 
            akid,            # STS Access Key ID
            aks,             # STS Access Key Secret
            token,           # STS Security Token
            "image/jpeg",
            type,
            region,
            bucket,
            endpoint
        )
    
    # 5. 更新预设信息
    print("步骤5: 更新预设信息")
    # 如果没有提供name，则使用文件夹名称
    preset_name = name if name else folder_name

    # 新增：构建仅展示 {name, content} 的 materials 数组
    materials_summary = []
    try:
        if material_json_to_upload:
            # material_json_to_upload 可能是文件路径或内存中的列表
            if isinstance(material_json_to_upload, str) and os.path.exists(material_json_to_upload):
                with open(material_json_to_upload, 'r', encoding='utf-8') as f:
                    materials_data = json.load(f)
            else:
                materials_data = material_json_to_upload

            if isinstance(materials_data, list):
                materials_summary = [
                    {"name": item.get("name"), "content": item.get("content")}
                    for item in materials_data
                ]
    except Exception as e:
        print(f"读取/解析素材JSON失败，将不展示materials: {e}")

    update_success = update_preset(
        preset_id,
        jwt_token,
        name=preset_name,
        url=zip_url,
        materials_url=material_json_oss_url or "",
        image_url=image_url or "",
        description=description if description else f"{folder_name} 预设",
        tags=tags
    )
    
    if update_success:
        print(f"预设上传和更新成功! 预设ID: {preset_id}")
        return {
            "preset_id": preset_id,
            "user_id": user_id,
            "name": preset_name,
            "url": zip_url,
            "materials": materials_summary,
            "image_url": image_url,
            "description": description if description else f"{folder_name} 预设",
            "tag": tags,
            "success": True
        }
    else:
        print("更新预设信息失败")
        return {
            "preset_id": preset_id,
            "user_id": user_id,
            "url": zip_url,
            "image_url": image_url,
            "success": False
        }


# ---------------------------------------------------
# 素材扫描函数
# ---------------------------------------------------

def scan_draft_materials(draft_folder: str) -> List[Dict[str, Any]]:
    """
    扫描 draft_content.json 文件，提取所有素材的关键信息并解析本地路径。

    Args:
        draft_folder: 预设文件夹的根路径。

    Returns:
        list: 包含提取出的素材信息的字典列表。
    """
    draft_content_path = os.path.join(draft_folder, 'preset_draft', 'draft_content.json')
    if not os.path.exists(draft_content_path):
        print(f"❌ 错误: draft_content.json 文件不存在: {draft_content_path}")
        return []

    materials_list = []
    
    try:
        print(f"✅ 找到并正在读取文件: {os.path.realpath(draft_content_path)}")
        with open(draft_content_path, 'r', encoding='utf-8') as f:
            draft_content = json.load(f)
        
        try:
            draft_materials = {}
            for d in draft_content.get('materials', {}).get('drafts', []):
                m = d.get('draft', {}).get('materials', {})
                if isinstance(m, dict):
                    for k, v in m.items():
                        if isinstance(v, list):
                            draft_materials.setdefault(k, []).extend(v)
        except Exception:
            print("❌ 错误: 无法解析 draft_content.json 的主要素材结构路径。")
            return []
        
        
        # 定义需要扫描的素材类型
        material_keys = {
            'audio': 'audios', 
            'video': 'videos',     # 特殊处理
            'text': 'texts',
        }
        
        # 用于增量命名的计数器
        name_counters = {key: 1 for key in material_keys.keys()}
        # 确保 name_counters 中包含所有可能出现的类型
        name_counters['image'] = 1 

        # 遍历每种素材类型
        for material_type, key in material_keys.items():
            if key in draft_materials and isinstance(draft_materials[key], list):
                materials = draft_materials[key]
                print(f"🔎 正在扫描 {material_type} ({key})... 发现 {len(materials)} 条记录。")
                
                for material in materials:
                    item_id = material.get('id')
                    
                    final_material_type = material_type
                    resolved_content_or_path = None

                    # --- 1. 类型判断和内容提取 ---
                    if key == 'videos':
                        # 针对 'videos' 列表的特殊处理：区分 video 和 photo
                        material_sub_type = material.get('type') 
                        if material_sub_type == 'photo':
                            final_material_type = 'image' 
                        elif material_sub_type == 'video':
                            final_material_type = 'video' 
                    
                    if final_material_type == 'text':
                        # --- 文本素材特殊处理 ---
                        # 读取 material.content (JSON string) 并提取内嵌的 'text' 值
                        raw_content_json_str = material.get('content', '{}') 
                        try:
                            # 尝试解析为 JSON
                            parsed_json = json.loads(raw_content_json_str)
                            # 提取内嵌的 'text'
                            if isinstance(parsed_json, dict):
                                resolved_content_or_path = parsed_json.get('text', '') 
                            else:
                                # 不是 dict，直接用原始字符串
                                resolved_content_or_path = raw_content_json_str
                        except json.JSONDecodeError:
                            print(f"警告: 无法解析文本素材 {item_id} 的 'content' 字段。使用原始字符串。")
                            resolved_content_or_path = raw_content_json_str

                    elif final_material_type in ['audio', 'video', 'image', 'sticker']:
                        # --- 文件素材通用处理 ---
                        item_path = material.get('path') or material.get('remote_url')
                        if final_material_type == 'video' and (not item_path or str(item_path).strip() == ''):
                            continue
                        # 使用路径解析函数
                        resolved_content_or_path = resolve_preset_placeholder_path(item_path, draft_folder)
                    
                    # --- 2. 增量命名 ---
                    new_name = f"{final_material_type}{name_counters[final_material_type]}"
                    name_counters[final_material_type] += 1
                    
                    # --- 3. 添加到列表 ---
                    # 注意：这里使用动态的 output_field_name ('content' 或 'path')
                    materials_list.append({
                        'id': item_id,
                        'content': resolved_content_or_path, 
                        'name': new_name,      
                        'type': final_material_type, 
                    })

    except json.JSONDecodeError:
        print(f"❌ 错误: 无法解析 JSON 文件: {draft_content_path}。")
    except Exception as e:
        print(f"❌ 扫描素材时发生异常: {str(e)}")

    return materials_list

def save_materials_to_json(materials_list: List[Dict[str, Any]], output_file: str) -> int:
    """
    将扫描到的素材列表保存为 JSON 文件。
    
    Args:
        materials_list: 包含素材信息的字典列表。
        output_file: 输出的 JSON 文件名。

    Returns:
        int: 0 表示成功，1 表示失败。
    """
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            # 确保输出的 JSON 格式美观且支持中文
            json.dump(materials_list, f, ensure_ascii=False, indent=4)
        print(f"\n✅ 素材列表扫描完成，共找到 {len(materials_list)} 条记录。")
        print(f"文件已成功保存至: {output_file}")
        return 0
    except Exception as e:
        print(f"❌ 保存结果到文件失败: {str(e)}")
        return 1

def scan_and_save_materials(draft_folder: str, output_file: str = 'scanned_materials.json') -> int:
    """
    扫描剪映预设文件夹中的 draft_content.json 文件，并将素材列表保存为 JSON 文件。
    
    Args:
        draft_folder: 本地预设根文件夹路径 (例如: /path/to/my_preset_folder)。
        output_file: 输出的 JSON 文件名 (默认: scanned_materials.json)。

    Returns:
        int: 0 表示成功，1 表示失败。
    """
    # 扫描素材
    materials_list = scan_draft_materials(draft_folder)
    
    if materials_list:
        # 保存到 JSON 文件
        return save_materials_to_json(materials_list, output_file)
    else:
        print("\n⚠️ 未找到任何素材或扫描过程中发生错误。")
        return 1

def main():
    """
    命令行入口函数，解析 upload 或 scan 子命令并执行相应逻辑。
    """
    parser = argparse.ArgumentParser(description='剪映预设处理工具。可用于素材扫描或预设上传。')
    subparsers = parser.add_subparsers(dest='command', required=True, help='选择要执行的操作: upload 或 scan')

    # --- UPLOAD 命令解析器 ---
    upload_parser = subparsers.add_parser('upload', help='上传预设文件夹到OSS')
    upload_parser.add_argument('--preset_folder', '-l', required=True, help='本地预设文件夹路径')
    upload_parser.add_argument('--token', '-t', required=True, help='JWT令牌，用于API认证')
    upload_parser.add_argument('--material_json_file', '-m', help='可选：指定预先生成的素材JSON文件路径。如果未指定，将自动扫描并生成。')
    upload_parser.add_argument('--name', help='预设名称，默认使用文件夹名称')
    upload_parser.add_argument('--description', help='预设描述')
    upload_parser.add_argument('--tags', help='预设标签，多个标签用逗号分隔')

    # --- SCAN 命令解析器 ---
    scan_parser = subparsers.add_parser('scan', help='扫描并提取 draft_content.json 中的素材列表')
    scan_parser.add_argument('--preset_folder', '-d', required=True, help='本地预设根文件夹路径 (包含 preset_draft/draft_content.json 的目录)。')
    scan_parser.add_argument('--output_file', '-o', default='scanned_materials.json', help='输出的 JSON 文件名 (默认: scanned_materials.json)。')

    args = parser.parse_args()

    if args.command == 'upload':
        print("--- 开始预设上传流程 ---")
        # 注意: upload_parser 中使用的参数名是 preset_folder，但传入函数时应与函数定义保持一致
        result = upload_folder_zip_to_oss(
            args.preset_folder, # 使用 preset_folder
            args.token, 
            name=args.name, 
            description=args.description, 
            tags=args.tags,
            material_json_path=args.material_json_file # 传入新增参数
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result and result.get('success') else 1
    
    elif args.command == 'scan':
        print("--- 🎬 开始剪映预设素材扫描流程 ---")
        return scan_and_save_materials(args.preset_folder, args.output_file) # 使用 draft_folder

if __name__ == "__main__":
    upload_folder_zip_to_oss("/Users/sunguannan/Movies/JianyingPro/User Data/Presets/Combination/Presets/preset_pip_r6", "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2OTIxODEwYmFiOGJmYWQ2NTE2ZWNjZDEiLCJpYXQiOjB9.WTLQX5OPEWfW3nJgcG8CsqEAV_Yn-WYn2pkS5GGbg7TyJG5aKRESORvH_tJqZJmE1kwuV5dvVbrHXOrIobum-S8kc1_Qe1NswCwpbxb79ySfY1w55hYPGncAHmpp1bVo4aowcd43vxJgKT6lTieQlOq_4wyoO_UJjeFbZbVf-bv0gGm0-8nMXI2Vj7eT4nIyqjSp-lfMADecS18r5CAParXualh4JJaEE3TOKGGo1Et3iBITf0KB70zWucPJIZZir6dz1LdbmMItPERN-wlQ5eFTSErCrLM0dxpzjREaVnv17XXvfirj-DjW7szN1aPnAYKt4bypOkafj9Cx-Fy40g")
    # upload_folder_zip_to_oss(
    #     "/Users/sunguannan/Movies/JianyingPro/User Data/Presets/Combination/Presets/preset_pip_r4", 
    #     "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvY2FQTjY2TFpNd0tTd3N1UUdENnRGb3A5WU9jIiwiaWF0IjowfQ.AWE__1fvmVfDGRFrHknu1AZz6wX3UaDZhrUTUugNTZSAX7bHBM68evZ8UiqfliuyUk0-Kjv0-xzNnKfyduWpwbVMm5OwUuZrv837KYOLs-LlYxT197Ojv2271BSPkLXsRXcNg-6CEPk1d25HVJxRgEZyK4W7wiHTpbNArMffl6w_1ju54Nib3r6ypG-7GU3VKkukeS9T6fBNeB4A83EuVJwi8Rgi2FpRvaDyU1sF8Hk2NlnE6s3krs6Yg7Ny3eGfJXemGfQwdLiNLYwhlfi7V0eA-Bfxy4QXbLcRrWLGpOJY2XUHCJyq7G0WcgFJVVY4qVOJO9vZUsn3sy2rcpummg",
    #     description="画中画，video1,video2,image1, image2, 竖版视频，正方形图片，video2和video1相同，有缩放居中的动画", 
    #     name="preset_pip_video1_video2_image1_image2_8d58fb11-91bb-4b03-8303-dec4c7c3b421",
    #     tags="文字, 2行", 
    #     material_json_path='/Users/sunguannan/pyJianYingDraft/upload_preset/tmp_upload/8d58fb11-91bb-4b03-8303-dec4c7c3b421_scanned_materials.json')
    # exit(main())