/** A completed tool result is the authority for whether a change happened. */
export function schedulerResultChanged(value:unknown):boolean {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const result=value as Record<string,unknown>;
  if(result.changed===false||result.ok===false||result.success===false||
    result.requiresConfirmation===true||result.requiresClarification===true||
    result.requiresLockedOverride===true||result.requiresOccupiedReplacementConfirmation===true||
    (typeof result.status==="number"&&result.status>=400))return false;
  return result.changed===true||result.saved===true||result.success===true||result.ok===true;
}
