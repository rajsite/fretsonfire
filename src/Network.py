#####################################################################
# -*- coding: iso-8859-1 -*-                                        #
#                                                                   #
# Frets on Fire                                                     #
# Copyright (C) 2006 Sami Ky�stil�                                  #
#                                                                   #
# This program is free software; you can redistribute it and/or     #
# modify it under the terms of the GNU General Public License       #
# as published by the Free Software Foundation; either version 2    #
# of the License, or (at your option) any later version.            #
#                                                                   #
# This program is distributed in the hope that it will be useful,   #
# but WITHOUT ANY WARRANTY; without even the implied warranty of    #
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the     #
# GNU General Public License for more details.                      #
#                                                                   #
# You should have received a copy of the GNU General Public License #
# along with this program; if not, write to the Free Software       #
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston,        #
# MA  02110-1301, USA.                                              #
#####################################################################

"""
In-process transport for the game's client/server sessions.

The original implementation used asyncore TCP sockets on the loopback
interface. asyncore no longer exists in Python 3.12+ and browsers cannot open
raw sockets, so connections to a local server are paired in memory instead.
Packets are still delivered only from communicate(), preserving the original
event ordering.
"""

import collections
import struct

import Log

PORT = 12345
LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1", "")

# port -> Server listening on it
_servers = {}
# live connections, in creation order
_connections = []

class ObjectCollection(dict):
  def __init__(self):
    dict.__init__(self)
    self.idCounter = -1
    self.objMap = {}

  def add(self, object, id = None):
    id = id or self.generateId()
    self[id] = object
    return id

  def id(self, object):
    try:
      return self.objMap[object]
    except KeyError:
      pass

  def __delitem__(self, id):
    try:
      del self.objMap[self[id]]
      del self[id]
    except KeyError:
      pass

  def __setitem__(self, id, object):
    self.objMap[object] = id
    dict.__setitem__(self, id, object)

  def generateId(self):
    self.idCounter += 1
    return self.idCounter
  
class NetworkError(IOError):
  pass

class Connection(object):
  def __init__(self, sock = None):
    self.id        = None
    self.server    = None
    self.peer      = None
    self.addr      = None
    self.connected = False
    self._outbox   = collections.deque()
    self._closed   = False
    self._peerClosed = False
    _connections.append(self)

    # When created by a server, 'sock' is the client end to pair with.
    if sock is not None:
      self.peer, sock.peer = sock, self
      self.addr = sock.addr
      self.connected = sock.connected = True

  def connect(self, host, port = PORT):
    assert self.id is None

    if host not in LOCAL_HOSTS:
      raise NetworkError("Only local games are supported (cannot connect to %s)." % host)
    server = _servers.get(port)
    if not server:
      raise NetworkError("No game server is running on port %d." % port)
    self.addr = (host, port)
    server._accept(self)
    communicate()

  def accept(self, id):
    assert self.id is None
    
    self.id = id
    self._outbox.append(struct.pack("H", self.id))
    self.handleRegistration()

  def setServer(self, server):
    self.server = server

  def handleConnect(self):
    pass

  def _receive(self, packet):
    # The first packet contains the ID
    if self.id is None:
      self.id = struct.unpack("H", packet)[0]
      self.handleRegistration()
    else:
      self.handlePacket(packet)

  def _deliver(self):
    while self._outbox and self.peer and not self.peer._closed:
      self.peer._receive(self._outbox.popleft())

  def sendPacket(self, packet):
    self._outbox.append(packet)

  def handlePacket(self, packet):
    pass

  def close(self):
    if self._closed:
      return
    self._closed   = True
    self.connected = False
    if self in _connections:
      _connections.remove(self)
    peer, self.peer = self.peer, None
    # Like a socket EOF, the other end notices the close on the next communicate().
    if peer and not peer._closed:
      peer._peerClosed = True
    self.handleClose()

  def handleClose(self):
    if self.server:
      self.server.handleConnectionClose(self)
    self.id = None

  def handleRegistration(self):
    pass

class Server(object):
  def __init__(self, port = PORT, localOnly = True):
    if port in _servers:
      raise NetworkError("A game server is already running on port %d." % port)
    self.port = port
    self.clients = {}
    self.__idCounter = 0
    _servers[port] = self
        
  def _accept(self, clientConnection):
    self.__idCounter += 1
    conn = self.createConnection(sock = clientConnection)
    conn.setServer(self)
    conn.accept(self.__idCounter)
    self.clients[self.__idCounter] = conn
    self.handleConnectionOpen(conn)

  def createConnection(self, sock):
    return Connection(sock = sock)

  def handleConnectionOpen(self, connection):
    pass

  def close(self):
    if _servers.get(self.port) is self:
      del _servers[self.port]
    self.handleClose()

  def handleClose(self):
    for c in list(self.clients.values()):
      c.close()

  def handleConnectionClose(self, connection):
    if connection.id in self.clients:
      del self.clients[connection.id]

  def broadcastPacket(self, packet, ignore = [], meToo = True):
    for c in list(self.clients.values()):
      if not c.id in ignore:
        c.sendPacket(packet)
    if meToo:
      list(self.clients.values())[0].handlePacket(packet)

  def sendPacket(self, receiverId, packet):
    self.clients[receiverId].sendPacket(packet)

def communicate(cycles = 1):
  while cycles:
    for c in list(_connections):
      c._deliver()
    for c in list(_connections):
      if c._peerClosed:
        c.close()
    cycles -= 1

def shutdown():
  for c in list(_connections):
    c.close()
  for s in list(_servers.values()):
    s.close()
