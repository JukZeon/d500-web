import { createContext, useContext, useEffect, useRef } from 'react';
import type { ChirpFeatures, RadioModel } from './chirp';
import type { ChannelLibrary, ManagedChannel, TransferMode } from './shared-channels';
export interface ProfileAccess { name:string; channels:ManagedChannel[]; features?:ChirpFeatures; apply:(rows:ManagedChannel[],mode:TransferMode)=>void }
export interface SharedValue {
 library:ChannelLibrary; update:(library:ChannelLibrary)=>void; store:(rows:ManagedChannel[])=>void;
 transfer:(rows:ManagedChannel[])=>void; register:(model:RadioModel,read:()=>ProfileAccess)=>()=>void;
}
export const SharedContext=createContext<SharedValue|null>(null);
export function useSharedChannels(){const value=useContext(SharedContext);if(!value)throw Error('Missing shared channel workspace');return value;}
export function useSharedProfile(model:RadioModel,profile:ProfileAccess){
 const shared=useSharedChannels(),latest=useRef(profile);latest.current=profile;
 useEffect(()=>shared.register(model,()=>latest.current),[model,shared.register]);
 return shared;
}
