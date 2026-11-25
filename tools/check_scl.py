"""Static checks of the SCL sources in isobus_project_bundle (TIA Portal is not needed):
blocks balanced, every #variable declared, members of the PLC data types, text literals not longer than
their String[n], no empty statements. Usage: python3 tools/check_scl.py <file.scl> <types.udt>"""
import re, sys
def check(scl, udt):
    src=open(scl).read(); types_src=open(udt).read(); ok=True
    blocks=re.split(r'\n(?=(?:FUNCTION_BLOCK|FUNCTION) ")', src)
    types={m.group(1):set(re.findall(r'^\s*(\w+)\s*:',m.group(2),re.M)) for m in re.finditer(r'TYPE "(\w+)".*?STRUCT(.*?)END_STRUCT',types_src,re.S)}
    strlen={}
    for m in re.finditer(r'TYPE "(\w+)".*?STRUCT(.*?)END_STRUCT',types_src,re.S):
        for f in re.finditer(r'^\s*(\w+)\s*:\s*String\[(\d+)\]',m.group(2),re.M): strlen[(m.group(1),f.group(1))]=int(f.group(2))
    for b in blocks:
        m=re.match(r'(FUNCTION_BLOCK|FUNCTION) "(\w+)"', b)
        if not m: continue
        name=m.group(2); decl,_,body=b.partition('\nBEGIN')
        code=re.sub(r"'[^']*'","''",re.sub(r'//.*','',body))
        for o,c in [('IF','END_IF'),('CASE','END_CASE'),('FOR','END_FOR'),('WHILE','END_WHILE'),('REGION','END_REGION')]:
            no=len(re.findall(r'(?<![\w])'+o+r'(?![\w])',code)); nc=len(re.findall(r'(?<![\w])'+c+r'(?![\w])',code))
            if no!=nc: ok=False; print(name,o,no,c,nc)
        declared=set(re.findall(r'^\s*(\w+)\s*:', decl, re.M))
        missing=set(re.findall(r'(?<![0-9A-Za-z_])#(\w+)',code))-declared-{name}
        if missing: ok=False; print(name,'niet gedeclareerd:',sorted(missing))
        vt={mm.group(1):mm.group(2) for mm in re.finditer(r'^\s*(\w+)\s*:\s*(?:Array\[[^\]]*\] of )?"(\w+)"',decl,re.M)}
        nc=re.sub(r'//.*','',body)
        for var,member in set(re.findall(r'#(\w+)(?:\[[^\]]*\])?\.(\w+)',nc)):
            t=vt.get(var)
            if t in types and member not in types[t]: ok=False; print(name,'onbekend lid',var,member,t)
        for var,member,lit in re.findall(r"#(\w+)\.(\w+)\s*:=\s*'([^']*)'",nc):
            t=vt.get(var); L=strlen.get((t,member))
            if L and len(lit)>L: ok=False; print(name,f'tekst te lang ({len(lit)} > {L}):',lit)
        if re.search(r'^\s*;\s*$',nc,re.M): ok=False; print(name,'lege opdracht')
    print(scl.split('/')[-1],'statisch:', 'OK' if ok else 'FOUTEN')
check(sys.argv[1], sys.argv[2])
