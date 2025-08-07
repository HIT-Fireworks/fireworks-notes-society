export interface DataItem {
  name: string;
  is_dir: boolean;
  modified: Date;
  size: number;
  path: string;
}

export async function fetchList(
  path: string = "/",
  base: string = "https://olist.jwyihao.top",
): Promise<DataItem[]> {
  const res = await fetch(`${base}/api/fs/list`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "",
    },
    body: JSON.stringify({
      path: `/Fireworks/${path}`,
    }),
  });
  const data = await res.json();
  if (data.code !== 200) {
    throw "Error fetching data:" + data;
  }
  return data.data.content.map((item: any) => {
    return {
      name: item.name,
      is_dir: item.is_dir,
      modified: new Date(item.modified),
      size: item.size,
      path: `${path}/${item.name}`,
    };
  });
}
