const TYPES={b737:['B731','B732','B733','B734','B735','B736','B737','B738','B739','B37M','B38M','B39M'],a320:['A318','A319','A320','A321','A19N','A20N','A21N'],b747:['B741','B742','B743','B744','B748'],a380:['A388'],b777:['B772','B773','B77L','B77W'],a350:['A359','A35K'],turboprop:['AT43','AT45','AT72','AT75','AT76','DH8A','DH8B','DH8C','DH8D'],light:['C150','C152','C172','C182','C206','PA28','SR20','SR22']};
export function aircraftMesh(type){return Object.entries(TYPES).find(([,types])=>types.includes(type))?.[0]||null;}
export class Aircraft3D {
  constructor(C,viewer){this.C=C;this.viewer=viewer;this.entity=null;this.key='';}
  update(item,enabled){
    const C=this.C, mesh=item?.kind==='air'&&aircraftMesh(item.model), key=mesh?item.id+':'+mesh:'';
    if(key!==this.key){if(this.entity)this.viewer.entities.remove(this.entity);this.entity=null;this.key=key;
      if(mesh)this.entity=this.viewer.entities.add({id:'air-model:'+item.id,position:C.Cartesian3.fromDegrees(item.lon,item.lat,item.altitude||0),model:{uri:'./assets/models/'+mesh+'.gltf',minimumPixelSize:55,maximumScale:5},properties:{transport:item}});
    }
    if(!this.entity)return;
    const p=C.Cartesian3.fromDegrees(item.lon,item.lat,item.altitude||0),range=C.Cartesian3.distance(this.viewer.camera.positionWC,p);
    this.entity.show=enabled&&this.viewer.scene.mode===C.SceneMode.SCENE3D&&range<18000;
    this.entity.position=p;this.entity.orientation=C.Transforms.headingPitchRollQuaternion(p,new C.HeadingPitchRoll(C.Math.toRadians((item.bearing??0)-90),0,0));
  }
}
