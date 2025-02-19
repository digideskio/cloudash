var ObjectId = require('mongodb').ObjectID,
  request = require('request'),
  util = require('../util'),
  vendors = require('../../vendors'),
  config = require('../../config');



exports.updateVm = function(req, res) {
  var data = req.body;
  var vmID = req.params.id;

  var vms = vendors.mongo.collection('vms');
  vms.findOne({
    '_id': ObjectId(vmID)
  }, function(err, doc) {
    if (err || doc === null) {
      return res.status(500).json({
        'error': 'Error getting VM details (VIRT)'
      });
    }

    doc.owner = data.owner;

    vms.update({
      _id: ObjectId(doc._id)
    }, doc, function(err, output) {

      if (err) {
        return res.status(500).json({
          'error': 'Error saving VM details (DB)'
        });
      }
      return res.status(200).json({
        'id': vmID
      });
    });
  });
};

exports.createVm = function(req, res) {
  var data = req.body;

  //data.details.ram - mb
  //data.details.vcpu - cores
  //data.details.disk - gb
  //data.details.image - centos6, centos7, ubuntu14.04, debian7, sandbox

  util.validateGlobalResources(data.details.ram, data.details.vcpu, data.details.disk, function(err, available) {
    if (available === false) {
      return res.status(500).json({
        'error': 'Not enough resources'
      });
    }

    var context = '';
    if (req.user.auth.ssh && req.user.auth.ssh.length > 0) {
      context += 'CONTEXT=[ETH0_GATEWAY="$NETWORK[GATEWAY, NETWORK=\'' + vendors.onenetwork + '\']",NETWORK="YES",ETH0_DNS="$NETWORK[DNS, NETWORK=\'' + vendors.onenetwork + '\']",SSH_PUBLIC_KEY="' + req.user.auth.ssh + '"]\n';
    }

    //var template = vendors.one.getTemplate(0);
    //template.instantiate(data.details.hostname, undefined, undefined, function(err, vm) {

    //vendors.one.createVM('NAME="cloudash_' + data.details.hostname + '"\nGRAPHICS=[TYPE="vnc",LISTEN="0.0.0.0"]\nMEMORY="' + (data.details.ram || 1024) + '"\nVCPU="' + (data.details.vcpu || 1) + '"\nOS=[ARCH="x86_64"]\nNIC=[NETWORK="public",NETWORK_UNAME="oneadmin"]\nCPU="0.5"\n DISK=[IMAGE="' + (data.details.image) + '",IMAGE_UNAME="oneadmin"]\n ' + context, false, function(err, vm) {

    var template = vendors.one.getTemplate(parseInt(data.details.template));
    template.instantiate(data.details.hostname, undefined, 'MEMORY="' + (data.details.ram || 1024) + '"\nVCPU="' + (data.details.vcpu || 1) + '"\n ' + context, function(err, vm) {
      if (err) {
        console.log(err.toString());
        return res.status(500).json({
          'error': 'Error creating VM (VIRT)'
        });
      }

      var cursor = vendors.mongo.collection('vms').insertOne({
        'type': 'opennebula',
        'providerId': vm.id,
        'owner': req.user._id,
        'details': data.details
      }, function(err, result) {
        if (err) return res.status(500).json({
          'error': 'Error creating VM (DB)'
        });
        return res.status(200).json({
          'id': result.insertedId
        });
      });
    });

  }, req);
};

exports.deleteVm = function(req, res) {
  var vmID = req.params.id;

  var query = {
    _id: ObjectId(vmID)
  };
  if (req.user.type !== 'admin') query.owner = req.user._id;

  var vms = vendors.mongo.collection('vms');
  vms.findOne(query, function(err, doc) {
    if (err) {
      return res.status(500).json({
        'error': 'Error deleting VM (DB1)'
      });
    }

    var vm = vendors.one.getVM(doc.providerId);
    vm.action('delete', function(err, data) {
      if (err) {

        console.log(err.toString());
        return res.status(500).json({
          'error': 'Error deleting VM (VIRT)'
        });
      }

      vms.remove({
        _id: ObjectId(doc._id)
      }, function(err, result) {

        if (err) return res.status(500).json({
          'error': 'Error deleting VM (DB1)'
        });
        return res.status(200).json({
          'id': doc._id
        });
      });
    });
  });

};

exports.vmVNC = function(req, resp) {
  var vmID = req.params.id;

  getVM(req, vmID, function(err, doc) {
    if (err) {
      return resp.status(500).json({
        'error': 'Error fetching VM (DB)'
      });
    }

    var vmid = doc.providerId;
    var host = vendors.onesunstone;
    var cookie = '';
    var csrftoken = '';

    request.post({
      'url': host + '/login',
      'auth': {
        'user': vendors.oneauth.split(':')[0],
        'pass': vendors.oneauth.split(':')[1],
        'sendImmediately': true
      }
    }, function(err, res, body) {
      if (err) {
        console.log(err);
        return resp.status(500).json({
          'error': 'Error fetching VNC token (VIRT)'
        });
      }

      cookie = res.headers['set-cookie'][0].split(';')[0];
      request.get({
        'url': host + '/',
        headers: {
          'Cookie': cookie
        }
      }, function(err, res, body) {
        if (err) {
          return resp.status(500).json({
            'error': 'Error fetching VNC token (VIRT)'
          });
        }
        cookie = cookie + '; ' + res.headers['set-cookie'][0].split(';')[0];

        var aux = body.indexOf('csrftoken') + 11;
        csrftoken = body.slice(aux, aux + 32);

        request.post({
          'url': host + '/vm/' + vmid + '/startvnc',
          headers: {
            'Cookie': cookie
          },
          formData: {
            'csrftoken': csrftoken
          }
        }, function(err, res, body) {
          if (err) {
            return resp.status(500).json({
              'error': 'Error fetching VNC token (VIRT)'
            });
          }

          return resp.status(200).json({
            'token': JSON.parse(body).token,
            'address': vendors.onesunstone.replace('https://', '').replace('http://', '').split(':')[0]
          });
        });
      });
    });
  });
};

exports.interfaceAdd = function(req, res) {
  var vmID = req.params.id;

  getVM(req, vmID, function(err, doc) {
    if (err || doc === null) {
      return res.status(500).json({
        'error': 'Error getting VM details (VIRT)'
      });
    }

    var vm = vendors.one.getVM(doc.providerId);
    vm.attachNIC('NIC=[NETWORK="' + vendors.onenetwork + '",NETWORK_UNAME="oneadmin"]', function(err, data) {
      if (err) {
        return res.status(500).json({
          'error': 'Error attaching new interface to VM (VIRT)'
        });
      }
      return res.status(200).json({});
    });
  });
};

exports.interfaceDel = function(req, res) {
  var vmID = req.params.id;
  var interfaceID = req.params.nid;

  getVM(req, vmID, function(err, doc) {
    var vm = vendors.one.getVM(doc.providerId);
    vm.detachNIC(parseInt(interfaceID), function(err, data) {
      if (err) {
        console.log(err);
        return res.status(500).json({
          'error': 'Error detaching the interface from VM (VIRT)'
        });
      }
      return res.status(200).json({});
    });
  });
};

exports.vmDetails = function(req, res) {
  var vmID = req.params.id;
  var query = {
    _id: ObjectId(vmID)
  };

  if (req.user.type !== 'admin') query.owner = req.user._id;

  var vms = vendors.mongo.collection('vms');
  vms.findOne(query, function(err, doc) {
    if (err || doc === null) {
      return res.status(500).json({
        'error': 'Error getting VM details (VIRT)'
      });
    }

    var vm = vendors.one.getVM(doc.providerId);
    vm.info(function(err, data) {
      if (err) {
        return res.status(500).json({
          'error': 'Error getting VM details (VIRT)'
        });
      }

      if (parseInt(data.VM.STATE) >= 3 && parseInt(data.VM.LCM_STATE) === 3) {
        doc.details.status = 'running';
      } else if (parseInt(data.VM.STATE) === 8 && parseInt(data.VM.LCM_STATE) === 0) {
        doc.details.status = 'stopped';
      } else if (parseInt(data.VM.STATE) === 5 && parseInt(data.VM.LCM_STATE) === 0) {
        doc.details.status = 'paused';
      } else {
        doc.details.status = 'pending';
      }

      doc.details.interfaces = [];

      if (data.VM.TEMPLATE.NIC) {
        if (Array.isArray(data.VM.TEMPLATE.NIC)) {
          for (var i = 0; i < data.VM.TEMPLATE.NIC.length; i++) {
            doc.details.interfaces.push({
              'id': data.VM.TEMPLATE.NIC[i].NIC_ID,
              'ip': data.VM.TEMPLATE.NIC[i].IP,
              'mac': data.VM.TEMPLATE.NIC[i].MAC
            });
          }
        } else {
          doc.details.interfaces.push({
            'id': data.VM.TEMPLATE.NIC.NIC_ID,
            'ip': data.VM.TEMPLATE.NIC.IP,
            'mac': data.VM.TEMPLATE.NIC.MAC
          });
        }
      }

      vms.update({
        _id: ObjectId(doc._id)
      }, doc, function(err, output) {

        if (err) {
          return res.status(500).json({
            'error': 'Error saving VM details (DB)'
          });
        }
        return res.status(200).json(doc);
      });
    });
  });

};

exports.vmList = function(req, res) {
  var query = {};
  if (req.user.type !== 'admin') query.owner = req.user._id;

  var cursor = vendors.mongo.collection('vms').find(query);
  var found = [];
  cursor.each(function(err, doc) {
    if (doc !== null) {
      found.push(doc);
    } else {
      return res.status(200).json(found);
    }
  });

};

exports.templateList = function(req, res) {
  vendors.one.getTemplates(function(err, templates) {
    if (err) {
      console.log(err);
      return res.status(500).json({
        'error': 'Error fetching template list (VIRT)'
      });
    }

    var output = [];
    for (var i = 0; i < templates.length; i++) {
      if (templates[i] !== undefined) {
        output.push({
          'id': templates[i].ID,
          'name': templates[i].NAME
        });
      }
    }
    return res.status(200).json({
      'templates': output
    });
  }, -2);
};

exports.imageList = function(req, res) {
  vendors.one.getImages(function(err, images) {
    if (err) {
      console.log(err);
      return res.status(500).json({
        'error': 'Error fetching image list (VIRT)'
      });
    }

    var output = [];
    for (var i = 0; i < images.length; i++) {
      if (images[i] !== undefined) {
        if (images[i].TYPE == '0') {
          output.push(images[i].NAME);
        }
      }
    }

    return res.status(200).json({
      'images': output
    });
  }, -2);
};

exports.startVm = function(req, res) {
  var vmID = req.params.id;

  getVM(req, vmID, function(err, doc) {
    if (err) {
      return res.status(500).json({
        'error': 'Error fetching VM (DB)'
      });
    }

    var vm = vendors.one.getVM(doc.providerId);
    vm.action('resume', function(err, data) {
      if (err) {
        console.log(err.toString());
        return res.status(500).json({
          'error': 'Error starting VM (VIRT)'
        });
      }

      return res.status(200).json({
        'id': vmID
      });
    });
  });
};

exports.pauseVm = function(req, res) {
  var vmID = req.params.id;

  getVM(req, vmID, function(err, doc) {
    if (err) {
      return res.status(500).json({
        'error': 'Error fetching VM (DB)'
      });
    }

    var vm = vendors.one.getVM(doc.providerId);
    vm.action('suspend', function(err, data) {
      if (err) {
        console.log(err.toString());
        return res.status(500).json({
          'error': 'Error suspending VM (VIRT)'
        });
      }

      return res.status(200).json({
        'id': vmID
      });
    });
  });
};

exports.stopVm = function(req, res) {
  var vmID = req.params.id;
  var forced = req.params.forced;
  var action = 'poweroff';
  if (forced === true) {
    action = 'poweroff-hard';
  }

  getVM(req, vmID, function(err, doc) {
    if (err) {
      return res.status(500).json({
        'error': 'Error fetching VM (DB)'
      });
    }

    var vm = vendors.one.getVM(doc.providerId);
    vm.action(action, function(err, data) {
      if (err) {
        console.log(err.toString());
        return res.status(500).json({
          'error': 'Error powering off VM (VIRT)'
        });
      }
      return res.status(200).json({
        'id': vmID
      });
    });
  });
};

exports.restartVm = function(req, res) {
  var vmID = req.params.id;
  var forced = req.params.forced;
  var action = 'reboot';
  if (forced === true) {
    action = 'reboot-hard';
  }

  getVM(req, vmID, function(err, doc) {
    if (err) {
      return res.status(500).json({
        'error': 'Error fetching VM (DB)'
      });
    }

    var vm = vendors.one.getVM(doc.providerId);
    vm.action(action, function(err, data) {
      if (err) {
        console.log(err.toString());
        return res.status(500).json({
          'error': 'Error rebooting VM (VIRT)'
        });
      }
      return res.status(200).json({
        'id': vmID
      });
    });
  });
};

exports.vmResize = function(req, res) {
  var vmID = req.params.id;
  var data = req.body;

  getVM(req, vmID, function(err, doc) {
    if (err) {
      return res.status(500).json({
        'error': 'Error fetching VM (DB)'
      });
    }

    util.validateGlobalResources(data.ram - doc.details.ram, data.cpu - doc.details.vcpu, 0, function(err, available) {
      if (available === false) {
        return res.status(500).json({
          'error': 'Not enough resources'
        });
      }

      var vm = vendors.one.getVM(doc.providerId);
      vm.resize('MEMORY="' + (data.ram || 1024) + '"\nVCPU="' + (data.cpu || 1) + '"\nCPU="0.5"\n', true, function(err, datar) {
        if (err) {
          console.log(err.toString());
          return res.status(500).json({
            'error': 'Error resizing VM (VIRT)'
          });
        }


        var vms = vendors.mongo.collection('vms');

        doc.details.ram = data.ram;
        doc.details.vcpu = data.cpu;

        vms.update({
          _id: ObjectId(doc._id)
        }, doc, function(err, output) {


          return res.status(200).json({
            'id': vmID
          });
        });

      });
    }, req);
  });
};

exports.statsVm = function(req, res) {
  var vmID = req.params.id;

  getVM(req, vmID, function(err, doc) {
    if (err) {
      return res.status(500).json({
        'error': 'Error fetching VM (DB)'
      });
    }

    var vm = vendors.one.getVM(doc.providerId);
    vm.monitoring(function(err, data) {
      if (err) {
        console.log(err.toString());
        return res.status(500).json({
          'error': 'Error fetching VM statistics (VIRT)'
        });
      }

      var output = [];

      if (data.MONITORING_DATA && data.MONITORING_DATA.VM) {
        for (var i = 0; i < data.MONITORING_DATA.VM.length; i++) {
          output.push({
            'time': data.MONITORING_DATA.VM[i].LAST_POLL,
            'cpu': data.MONITORING_DATA.VM[i].CPU,
            'memory': data.MONITORING_DATA.VM[i].MEMORY,
            'nettx': data.MONITORING_DATA.VM[i].NET_TX,
            'netrx': data.MONITORING_DATA.VM[i].NET_RX
          });
        }
      }

      return res.status(200).json({
        'stats': output
      });
    });
  });
};

function getVM(req, vmID, callback) {
  var query = {
    _id: ObjectId(vmID)
  };
  if (req.user.type !== 'admin') query.owner = req.user._id;

  var vms = vendors.mongo.collection('vms');
  vms.findOne({
    '_id': ObjectId(vmID)
  }, function(err, doc) {
    callback(err, doc);
  });
}