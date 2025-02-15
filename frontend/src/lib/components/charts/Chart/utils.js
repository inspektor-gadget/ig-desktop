let lastId = 0
export const getUniqueId = (prefix="") => {
    lastId++
    return [prefix, lastId].join("-")
}
