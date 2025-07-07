import { create } from 'ipfs-core';

const node = await create();
const uploadFile = async (file) => {
  const result = await node.add(file);
  return result.cid.toString();
};