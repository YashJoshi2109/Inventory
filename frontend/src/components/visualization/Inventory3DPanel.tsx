import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html, ContactShadows, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { apiClient } from "@/api/client";
import type { Area, Location } from "@/types";
import { Loader2 } from "lucide-react";

export type WorkerAction = "idle" | "add" | "remove" | "transfer" | "modify";

// ─── Scene constants ───────────────────────────────────────────────────────────
// Place racks side-by-side in a single back row
const COL_X  = [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5];
const ROW_Z  = [-2.0];
const IDLE_Z = 1.0;     
const ACT_Z  = 0.2;     

const SHELF_Y = [0.44, 1.14, 1.84];
const RACK_H  = 2.55;
const RACK_W  = 1.6;
const RACK_D  = 0.6;

// Realistic Colors
const METAL_FRAME = "#94a3b8"; // Industrial grey metal
const METAL_SHELF = "#cbd5e1";
const FLOOR_C     = "#e2e8f0"; // Concrete-like light grey
const WALL_C      = "#f8fafc"; // White/off-white walls
const BOXES       = ["#ef4444", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#06b6d4"]; // Colorful realistic boxes
const LAB_COAT    = "#ffffff";
const PANTS       = "#1e293b";
const SKIN        = "#fcd34d";
const SCANNER     = "#0f172a";
const LASER       = "#ef4444"; 
const CYAN        = "#0ea5e9";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Slot {
  id: number; name: string; code: string;
  itemCount: number; capacity: number | null;
  rackIndex: number; shelfLevel: number;
}
interface Focus { id: number|null; code: string; name: string; itemCount: number; }

function fillRatio(c: number, cap: number|null) {
  if(c<=0) return 0;
  return Math.min(1, c / (cap&&cap>0 ? cap : 30));
}

// ─── Realistic Rack ─────────────────────────────────────────────────────────
function RackFrame({ x, z, isFocused, slots, focusId, onFocus }: {
  x:number; z:number; isFocused:boolean;
  slots:Slot[]; focusId:number|null;
  onFocus:(s:Slot)=>void;
}) {
  const glow = isFocused ? CYAN : "#000";
  const glowI = isFocused ? 0.4 : 0;
  const corners:[number,number][] = [[-RACK_W/2,-RACK_D/2],[RACK_W/2,-RACK_D/2],[-RACK_W/2,RACK_D/2],[RACK_W/2,RACK_D/2]];
  return (
    <group position={[x,0,z]}>
      {corners.map(([cx,cz],i)=>(
        <mesh key={i} position={[cx,RACK_H/2,cz]} castShadow receiveShadow>
          <boxGeometry args={[0.06, RACK_H, 0.06]}/>
          <meshStandardMaterial color={METAL_FRAME} metalness={0.6} roughness={0.3} emissive={glow} emissiveIntensity={glowI}/>
        </mesh>
      ))}
      {SHELF_Y.map((sy,level)=>{
        const slot=slots.find(s=>s.shelfLevel===level);
        const f=slot?fillRatio(slot.itemCount,slot.capacity):0;
        const bCnt=Math.round(f*12);
        const foc=slot?focusId===slot.id:false;
        return (
          <group key={level}>
            <mesh position={[0,sy,0]} receiveShadow castShadow onClick={e=>{e.stopPropagation();if(slot)onFocus(slot);}}>
              <boxGeometry args={[RACK_W,0.04,RACK_D]}/>
              <meshStandardMaterial color={foc?"#bae6fd":METAL_SHELF} roughness={0.5} metalness={0.2}
                emissive={foc?"#0ea5e9":"#000"} emissiveIntensity={foc?0.2:0}/>
            </mesh>
            {Array.from({length:bCnt}).map((_,bi)=>{
              const col=bi%4,row=Math.floor(bi/4);
              const bc=BOXES[(((slot?.id??0)+bi)%BOXES.length)];
              return (
                <mesh key={bi} position={[-0.45+col*0.3,sy+0.15,-0.12+row*0.24]}
                  scale={foc?1.05:1} castShadow receiveShadow onClick={e=>{e.stopPropagation();if(slot)onFocus(slot);}}>
                  <boxGeometry args={[0.26,0.28,0.22]}/>
                  <meshStandardMaterial color={bc} roughness={0.4} metalness={0.1} emissive={foc?"#ffffff":"#000"} emissiveIntensity={foc?0.15:0}/>
                </mesh>
              );
            })}
            {foc&&slot&&(
              <Html position={[0,sy+0.52,RACK_D/2+0.12]} center style={{pointerEvents:"none"}}>
                <div style={{background:"rgba(255,255,255,0.95)",border:`1px solid ${CYAN}`,
                  boxShadow:`0 4px 14px rgba(0,0,0,0.1)`,borderRadius:8,padding:"4px 12px",
                  fontSize:12,fontWeight:700,color:"#0f172a",whiteSpace:"nowrap"}}>
                  <span style={{color:"#0284c7",fontFamily:"monospace"}}>{slot.code}</span>
                  <span style={{color:"#64748b",marginLeft:7}}>{slot.itemCount} items</span>
                </div>
              </Html>
            )}
          </group>
        );
      })}
      <mesh position={[0,RACK_H,0]} castShadow>
        <boxGeometry args={[RACK_W+0.02,0.04,RACK_D+0.02]}/>
        <meshStandardMaterial color={METAL_FRAME} metalness={0.6} roughness={0.3}/>
      </mesh>
      {isFocused&&(
        <mesh position={[0,0.01,0]} rotation={[-Math.PI/2,0,0]}>
          <ringGeometry args={[0.8,1.0,32]}/>
          <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={1} transparent opacity={0.6}/>
        </mesh>
      )}
    </group>
  );
}

function AllRacks({ slots,focusId,onFocus }:{slots:Slot[];focusId:number|null;onFocus:(s:Slot)=>void;}) {
  const byRack=useMemo(()=>{
    const m=new Map<number,Slot[]>();
    for(const s of slots){const a=m.get(s.rackIndex)??[];a.push(s);m.set(s.rackIndex,a);}
    return m;
  },[slots]);
  return (
    <group>
      {COL_X.map((cx,ci)=>ROW_Z.map((rz,ri)=>{
        const ri2=ci+ri*COL_X.length;
        const rs=byRack.get(ri2)??[];
        return <RackFrame key={ri2} x={cx} z={rz} isFocused={rs.some(s=>s.id===focusId)}
          slots={rs} focusId={focusId} onFocus={onFocus}/>;
      }))}
    </group>
  );
}

// ─── Carried box ──────────────────────────────────────────────────────────────
function CarriedBox({visible}:{visible:boolean}) {
  if(!visible) return null;
  return (
    <mesh position={[0, -0.25, 0.15]} castShadow>
      <boxGeometry args={[0.26,0.28,0.22]}/>
      <meshStandardMaterial color={BOXES[1]} roughness={0.4} />
    </mesh>
  );
}

// ─── Realistic Human Worker (Capsule-based) ──────────────────────────────────
function HumanWorker({action,targetX}:{action:WorkerAction;targetX:number}) {
  const root  = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Mesh>(null);
  const lLeg  = useRef<THREE.Mesh>(null);
  const rLeg  = useRef<THREE.Mesh>(null);
  const lArm  = useRef<THREE.Group>(null);
  const rArm  = useRef<THREE.Group>(null);
  const hd    = useRef<THREE.Mesh>(null);
  const beam  = useRef<THREE.Mesh>(null);

  const [carry, setCarry] = useState(false);
  const [laserOn, setLaserOn] = useState(false);

  useFrame((s,dt)=>{
    const t=s.clock.getElapsedTime();
    if(!root.current)return;

    const p=root.current.position;
    const tzTarget = action==="idle" ? IDLE_Z : ACT_Z;
    const dx=targetX-p.x;
    const dz=tzTarget-p.z;
    p.x+=dx*Math.min(dt*3.0,1);
    p.z+=dz*Math.min(dt*3.0,1);

    const walkingX=Math.abs(dx)>0.1;
    const walkingZ=Math.abs(dz)>0.1;
    const walking=walkingX||walkingZ;
    const speed=walking?4.0:0;
    const leg=Math.sin(t*speed)*0.5;
    const armSwing=Math.sin(t*speed)*0.3;

    // Rotation logic
    if(walkingX){
      const ta=dx>0?-Math.PI/2:Math.PI/2;
      root.current.rotation.y+=(ta-root.current.rotation.y)*dt*8;
    } else if(walkingZ&&dz<0){
      root.current.rotation.y+=(0-root.current.rotation.y)*dt*8; 
    } else if(action!=="idle"){
      root.current.rotation.y+=(Math.PI-root.current.rotation.y)*dt*8;
    } else {
      root.current.rotation.y+=Math.sin(t*0.5)*0.005;
    }

    // Body bob
    p.y=walking?Math.abs(Math.sin(t*speed*2))*0.03:0;

    // Limbs
    if(lLeg.current) lLeg.current.rotation.x=leg;
    if(rLeg.current) rLeg.current.rotation.x=-leg;

    // ─── Cinematic Animation Sequences ───
    const cycle = (t * 0.8) % 8; // 10-second loop
    let targetLArmX = -armSwing;
    let targetLArmZ = 0.1;
    let targetRArmX = armSwing;
    let targetRArmZ = -0.1;
    let showLaser = false;
    let isCarrying = false;

    if (action === "add") {
      // Pick up -> Scan Item -> Scan Rack -> Place
      if (cycle < 2) {
        targetLArmX = -0.5; targetRArmX = -0.5; isCarrying = true;
      } else if (cycle < 4) {
        targetLArmX = -1.2; targetRArmX = -0.8; showLaser = true; isCarrying = true;
      } else if (cycle < 6) {
        targetLArmX = -1.2; targetRArmX = -1.5; showLaser = true; isCarrying = true;
      } else {
        targetLArmX = -0.2; targetRArmX = 0; isCarrying = false;
      }
    } 
    else if (action === "remove") {
      // Scan Rack -> Scan Item -> Grab -> Pull back
      if (cycle < 2) {
        targetRArmX = -1.5; showLaser = true;
      } else if (cycle < 4) {
        targetRArmX = -1.2; showLaser = true;
      } else if (cycle < 6) {
        targetLArmX = -1.5; targetRArmX = 0; isCarrying = true;
      } else {
        targetLArmX = -0.5; isCarrying = true;
      }
    }
    else if (action === "transfer") {
      if (cycle < 2) {
        targetRArmX = -1.5; showLaser = true;
      } else if (cycle < 4) {
        targetLArmX = -1.2; isCarrying = true;
      } else if (cycle < 6) {
        targetRArmX = -1.5; showLaser = true; isCarrying = true;
      } else {
        targetLArmX = 0; isCarrying = false;
      }
    }
    else if (action === "modify") {
      if (cycle < 2) {
        targetRArmX = -1.2; showLaser = true;
      } else if (cycle < 5) {
        targetLArmX = -0.8; targetRArmX = -0.6; targetRArmZ = 0.2;
      } else {
        targetRArmX = -1.5; showLaser = true;
      }
    }

    setCarry(isCarrying);
    setLaserOn(showLaser);

    // Apply arm rotations smoothly
    if(lArm.current){
      lArm.current.rotation.x += (targetLArmX - lArm.current.rotation.x) * dt * 5;
      lArm.current.rotation.z += (targetLArmZ - lArm.current.rotation.z) * dt * 5;
    }
    if(rArm.current){
      rArm.current.rotation.x += (targetRArmX - rArm.current.rotation.x) * dt * 5;
      rArm.current.rotation.z += (targetRArmZ - rArm.current.rotation.z) * dt * 5;
    }

    // Head look
    if(hd.current){
      hd.current.rotation.y=walking?Math.sin(t*speed*0.5)*0.1:Math.sin(t*1.2)*0.1;
      hd.current.rotation.x=(action!=="idle"&&!walking)?-0.15:0;
    }

    // Laser pulse
    if(beam.current){
      const m=beam.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = laserOn ? 2.0 + Math.sin(t*20)*1.0 : 0;
      m.opacity = laserOn ? 0.6 + Math.sin(t*20)*0.2 : 0;
    }
  });

  return (
    <group ref={root} position={[0,0,IDLE_Z]}>
      {/* Torso (Lab Coat) */}
      <mesh ref={torso} position={[0, 1.15, 0]} castShadow>
        <capsuleGeometry args={[0.18, 0.45, 16, 16]} />
        <meshStandardMaterial color={LAB_COAT} roughness={0.7} />
      </mesh>
      
      {/* Head */}
      <mesh ref={hd} position={[0, 1.65, 0]} castShadow>
        <sphereGeometry args={[0.14, 32, 32]} />
        <meshStandardMaterial color={SKIN} roughness={0.5} />
        {/* Safety Glasses */}
        <mesh position={[0, 0.02, 0.12]}>
          <boxGeometry args={[0.22, 0.08, 0.05]} />
          <meshStandardMaterial color="#0ea5e9" transparent opacity={0.6} roughness={0.1} metalness={0.8} />
        </mesh>
      </mesh>

      {/* Left Arm */}
      <group ref={lArm} position={[-0.24, 1.4, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow>
          <capsuleGeometry args={[0.07, 0.35, 16, 16]} />
          <meshStandardMaterial color={LAB_COAT} roughness={0.7} />
        </mesh>
        <mesh position={[0, -0.55, 0]} castShadow>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshStandardMaterial color={SKIN} roughness={0.5} />
        </mesh>
        <CarriedBox visible={carry}/>
      </group>

      {/* Right Arm (Scanner) */}
      <group ref={rArm} position={[0.24, 1.4, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow>
          <capsuleGeometry args={[0.07, 0.35, 16, 16]} />
          <meshStandardMaterial color={LAB_COAT} roughness={0.7} />
        </mesh>
        <mesh position={[0, -0.55, 0]} castShadow>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshStandardMaterial color={SKIN} roughness={0.5} />
        </mesh>
        {/* Scanner Device */}
        <group position={[0, -0.65, 0.08]} rotation={[0.4, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.08, 0.18, 0.06]} />
            <meshStandardMaterial color={SCANNER} roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh position={[0, 0.05, 0.031]}>
            <planeGeometry args={[0.06, 0.08]} />
            <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={0.5} />
          </mesh>
          {/* Laser Beam */}
          <mesh ref={beam} position={[0, 0.08, 0.5]}>
            <cylinderGeometry args={[0.01, 0.08, 1.0, 16]} />
            <meshStandardMaterial color={LASER} emissive={LASER} transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      </group>

      {/* Left Leg */}
      <mesh ref={lLeg} position={[-0.1, 0.45, 0]} castShadow>
        <capsuleGeometry args={[0.08, 0.45, 16, 16]} />
        <meshStandardMaterial color={PANTS} roughness={0.8} />
      </mesh>

      {/* Right Leg */}
      <mesh ref={rLeg} position={[0.1, 0.45, 0]} castShadow>
        <capsuleGeometry args={[0.08, 0.45, 16, 16]} />
        <meshStandardMaterial color={PANTS} roughness={0.8} />
      </mesh>
    </group>
  );
}

// ─── Clean White Room Environment ─────────────────────────────────────────────
function WhiteRoomEnvironment() {
  const logo = useTexture("/UTA_logo.webp");
  return (
    <group>
      {/* Polished Lab Floor */}
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.01,0]} receiveShadow>
        <planeGeometry args={[50,30]}/>
        <meshStandardMaterial color={FLOOR_C} roughness={0.2} metalness={0.1}/>
      </mesh>
      
      {/* Clean White Walls */}
      <mesh position={[0, 5, -8]} receiveShadow>
        <planeGeometry args={[50, 10]} />
        <meshStandardMaterial color={WALL_C} roughness={0.9} />
      </mesh>

      {/* SEAR LAB / UTA Logo */}
      <mesh position={[0, 4.5, -7.9]} receiveShadow>
        <planeGeometry args={[3.5, 3.5]} />
        <meshStandardMaterial map={logo} transparent={true} roughness={0.5} opacity={0.9} />
      </mesh>

      <mesh position={[-15, 5, 0]} rotation={[0, Math.PI/2, 0]} receiveShadow>
        <planeGeometry args={[30, 10]} />
        <meshStandardMaterial color={WALL_C} roughness={0.9} />
      </mesh>
      <mesh position={[15, 5, 0]} rotation={[0, -Math.PI/2, 0]} receiveShadow>
        <planeGeometry args={[30, 10]} />
        <meshStandardMaterial color={WALL_C} roughness={0.9} />
      </mesh>

      {/* Subtle Aisle Markings */}
      <mesh rotation={[-Math.PI/2,0,0]} position={[0, 0.001, ACT_Z/2]}>
        <planeGeometry args={[30, ACT_Z+0.8]}/>
        <meshStandardMaterial color="#cbd5e1" transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

// ─── Cinematic camera ─────────────────────────────────────────────────────────
function CinematicCamera({focus,action,workerX}:{focus:Focus;action:WorkerAction;workerX:number}) {
  const {camera}=useThree();
  const controlsRef = useRef<any>(null);
  const tPos=useRef(new THREE.Vector3(0, 3.0, 7.0));
  const tLook=useRef(new THREE.Vector3(0, 1.0, -1.0));
  const [userControlled, setUserControlled] = useState(false);

  useEffect(() => {
    if (action !== "idle" || focus.id) {
      setUserControlled(false);
    }
  }, [action, focus.id]);

  useFrame((_s,dt)=>{
    if(action!=="idle"){
      tPos.current.lerp(new THREE.Vector3(workerX*0.5, 2.2, 4.5), dt*2.0);
      tLook.current.lerp(new THREE.Vector3(workerX, 1.2, -1.0), dt*2.0);
    } else if(focus.id){
      tPos.current.lerp(new THREE.Vector3(workerX*0.6, 2.5, 5.5), dt*1.5);
      tLook.current.lerp(new THREE.Vector3(workerX, 1.2, -1.0), dt*1.5);
    } else {
      tPos.current.lerp(new THREE.Vector3(0, 3.0, 7.0), dt*1.0);
      tLook.current.lerp(new THREE.Vector3(0, 1.0, -1.0), dt*1.0);
    }

    if (!userControlled) {
      camera.position.lerp(tPos.current, dt*3.0);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(tLook.current, dt*3.0);
        controlsRef.current.update();
      } else {
        camera.lookAt(tLook.current);
      }
    }
  });

  return (
    <OrbitControls 
      ref={controlsRef}
      makeDefault
      enablePan={true} 
      enableZoom={true} 
      enableRotate={true}
      minDistance={3.5}
      maxDistance={12}
      maxPolarAngle={Math.PI/2 - 0.05}
      onStart={() => setUserControlled(true)}
    />
  );
}

// ─── Full warehouse scene ─────────────────────────────────────────────────────
function WarehouseScene({slots,action,focus,setFocus}:{
  slots:Slot[];action:WorkerAction;focus:Focus;setFocus:(f:Focus)=>void;
}) {
  const workerX=useMemo(()=>{
    if(!focus.id)return 0;
    const slot = slots.find(s => s.id === focus.id);
    return slot ? (COL_X[slot.rackIndex % COL_X.length] ?? 0) : 0;
  },[focus.id,slots]);

  return (
    <>
      {/* Bright Lab Lighting */}
      <ambientLight intensity={1.5} color="#ffffff"/>
      <directionalLight 
        position={[5, 10, 8]} 
        intensity={1.8} 
        color="#ffffff" 
        castShadow 
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      <directionalLight position={[-8, 8, -4]} intensity={0.6} color="#e2e8f0"/>
      
      {/* Soft Contact Shadows for realism */}
      <ContactShadows position={[0, 0.01, 0]} opacity={0.5} scale={40} blur={2.5} far={4} />

      <CinematicCamera focus={focus} action={action} workerX={workerX}/>
      <WhiteRoomEnvironment/>
      <AllRacks slots={slots} focusId={focus.id}
        onFocus={s=>setFocus({id:s.id,code:s.code,name:s.name,itemCount:s.itemCount})}/>
      <HumanWorker action={action} targetX={workerX}/>

      {focus.id&&(
        <Html position={[workerX, 3.2, -2.0]} center style={{pointerEvents:"none"}}>
          <div style={{background:"rgba(255,255,255,0.95)",border:`1px solid ${CYAN}`,
            boxShadow:`0 8px 30px rgba(0,0,0,0.12)`,borderRadius:12,padding:"6px 18px",
            fontSize:13,fontWeight:700,color:"#0f172a",whiteSpace:"nowrap"}}>
            <span style={{color:CYAN,fontFamily:"monospace"}}>{focus.code}</span>
            <span style={{color:"#cbd5e1",margin:"0 8px"}}>|</span>
            <span>{focus.name}</span>
            <span style={{color:"#cbd5e1",margin:"0 8px"}}>|</span>
            <span style={{color:"#10b981"}}>{focus.itemCount} items</span>
          </div>
        </Html>
      )}
    </>
  );
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function dot(a:WorkerAction):string {
  return {idle:"#94a3b8",add:"#10b981",remove:"#ef4444",transfer:CYAN,modify:"#8b5cf6"}[a];
}

// ─── Exported panel ───────────────────────────────────────────────────────────
export function Inventory3DPanel({action,phaseLabel,focusedLocationCode}:{
  action:WorkerAction; phaseLabel?:string; focusedLocationCode?:string|null;
}) {
  const [focus,setFocus]=useState<Focus>({id:null,code:"",name:"",itemCount:0});

  const {data:areas}=useQuery<Area[]>({
    queryKey:["viz-areas"],
    queryFn:async()=>{const{data}=await apiClient.get("/locations/areas");return data;},
    staleTime:60_000,
  });
  const {data:rawLocs,isLoading}=useQuery<Location[]>({
    queryKey:["viz-locations",areas?.map(a=>a.id).join(",")??"none"],
    queryFn:async()=>{
      if(!areas?.length)return[];
      const ch=await Promise.all(areas.map(a=>apiClient.get("/locations",{params:{area_id:a.id,page:1,page_size:50}})));
      return ch.flatMap(r=>Array.isArray(r.data)?r.data:(r.data.items??[])) as Location[];
    },
    enabled:!!areas,staleTime:60_000,
  });

  const slots=useMemo<Slot[]>(()=>{
    const active=(rawLocs??[]).filter(l=>l.is_active).slice(0,36);
    return active.map((loc,idx)=>({
      id:loc.id,name:loc.name,code:loc.code,
      itemCount:loc.item_count,capacity:loc.capacity,
      rackIndex:Math.floor(idx/3),shelfLevel:idx%3,
    }));
  },[rawLocs]);

  useEffect(()=>{
    if(!focusedLocationCode||!slots.length)return;
    const s=slots.find(sl=>sl.code===focusedLocationCode);
    if(s)setFocus({id:s.id,code:s.code,name:s.name,itemCount:s.itemCount});
  },[focusedLocationCode,slots]);

  useEffect(()=>{ if(action==="idle") setFocus({id:null,code:"",name:"",itemCount:0}); },[action]);

  const d=dot(action);

  return (
    <div className="relative w-full h-full flex flex-col rounded-2xl overflow-hidden"
      style={{
        background:"#ffffff",
        border:"1px solid #e2e8f0",
        boxShadow:"0 10px 40px -10px rgba(0,0,0,0.08)",
      }}>

      {/* Canvas */}
      <div className="relative flex-1 min-h-0">
        {isLoading&&(
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20"
            style={{background:"rgba(255,255,255,0.8)", backdropFilter:"blur(4px)"}}>
            <Loader2 size={26} className="animate-spin text-brand-500"/>
            <p className="text-sm text-slate-600 font-medium">Syncing inventory…</p>
          </div>
        )}
        <Canvas shadows camera={{position:[0,3.0,7.0],fov:45}}
          gl={{antialias:true,stencil:false,depth:true,alpha:false}}
          className="relative z-10" style={{background:"#f8fafc", touchAction: "none"}}>
          <color attach="background" args={["#f8fafc"]}/>
          <fog attach="fog" args={["#f8fafc", 15, 40]}/>
          <WarehouseScene slots={slots} action={action} focus={focus} setFocus={setFocus}/>
        </Canvas>
        
        {/* Top-left status overlay */}
        <div className="absolute top-3 left-3 z-10 pointer-events-none">
          <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-full shadow-sm border border-slate-200">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{background:d}}/>
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              {action}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
