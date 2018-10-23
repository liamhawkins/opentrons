import asyncio
import enum
import logging
from typing import List, Dict

from opentrons.protocol_api.labware import Well, Labware, load
from opentrons import types, hardware_control as hc
from . import geometry


MODULE_LOG = logging.getLogger(__name__)


class ProtocolContext:
    """ The Context class is a container for the state of a protocol.

    It encapsulates many of the methods formerly found in the Robot class,
    including labware, instrument, and module loading; core functions like
    pause and resume.
    """

    def __init__(self,
                 hardware: hc.API = None,
                 loop: asyncio.AbstractEventLoop = None) -> None:
        self._loop = loop or asyncio.get_event_loop()
        if hardware:
            self._hardware = hardware
        else:
            self._hardware = hc.API.build_hardware_simulator(loop=self._loop)
        self._deck_layout = geometry.Deck()
        self._instruments = {mount: None for mount in types.Mount}

    def connect(self, hardware: hc.API):
        """ Connect to a running hardware API.

        This can be either a simulator or a full hardware controller.
        """
        self._hardware = hardware
        self._loop.run_until_complete(
            self._hardware.cache_instruments())

    def disconnect(self):
        """ Disconnect from currently-connected hardware and simulate instead
        """
        self.connect(hc.API.build_hardware_simulator())

    def load_labware(
            self, labware_obj: Labware, location: types.DeckLocation,
            label: str = None, share: bool = False) -> Labware:
        """ Specify the presence of a piece of labware on the OT2 deck.

        This function loads the labware specified by ``labware``
        (previously loaded from a configuration file) to the location
        specified by ``location``.
        """
        self._deck_layout[location] = labware_obj
        return labware_obj

    def load_labware_by_name(
            self, labware_name: str, location: types.DeckLocation) -> Labware:
        """ A convenience function to specify a piece of labware by name.

        For labware already defined by Opentrons, this is a convient way
        to collapse the two stages of labware initialization (creating
        the labware and adding it to the protocol) into one.

        This function returns the created and initialized labware for use
        later in the protocol.
        """
        labware = load(labware_name,
                       self._deck_layout.position_for(location))
        return self.load_labware(labware, location)

    @property
    def loaded_labwares(self) -> Dict[int, Labware]:
        """ Get the labwares that have been loaded into the protocol context.

        The return value is a dict mapping locations to labware, sorted
        in order of the locations.
        """
        return dict(self._deck_layout)

    def load_instrument(
            self, instrument_name: str, mount: types.Mount) \
            -> 'InstrumentContext':
        """ Specify a specific instrument required by the protocol.

        This value will actually be checked when the protocol runs, to
        ensure that the correct instrument is attached in the specified
        location.
        """
        attached = {att_mount: instr.get('name', None)
                    for att_mount, instr
                    in self._hardware.attached_instruments.items()}
        attached[mount] = instrument_name
        self._loop.run_until_complete(
            self._hardware.cache_instruments(attached))
        # If the cache call didn’t raise, the instrument is attached
        return InstrumentContext(self, mount,
                                 [],
                                 self._hardware.attached_instruments[mount])

    def pause(self):
        """ Pause execution of the protocol until resume is called.

        Note: This function call will not return until the protocol
        is resumed (presumably by a user in the run app).
        """
        pass

    def resume(self):
        """ Resume a previously-paused protocol. """
        pass

    def comment(self, msg):
        """ Add a user-readable comment string that will be echoed to the
        Opentrons app. """
        pass

    def move_to(self, mount: types.Mount,
                location: geometry.Location,
                strategy: types.MotionStrategy = None):
        where = geometry.point_from_location(location)
        self._loop.run_until_complete(self._hardware.move_to(mount, where))

    def home(self):
        """ Homes the robot.
        """
        self._loop.run_until_complete(self._hardware.home())


class InstrumentContext:
    """ A context for a specific pipette or instrument.

    This can be used to call methods related to pipettes - moves or
    aspirates or dispenses, or higher-level methods.

    Instances of this class bundle up state and config changes to a
    pipette - for instance, changes to flow rates or trash containers.
    Action methods (like :py:meth:``aspirate`` or :py:meth:``distribute``) are
    defined here for convenience.

    In general, this class should not be instantiated directly; rather,
    instances are returned from :py:meth:``ProtcolContext.load_instrument``.
    """

    class MODE(enum.Enum):
        """ Definition for the modes in which a pipette can operate.
        """
        ASPIRATE = 'aspirate'
        DISPENSE = 'dispense'

    class TYPE(enum.Enum):
        """ Definition for the types of pipettte.
        """
        SINGLE = 'single'
        MULTI = 'multi'

    def __init__(self, ctx, mount: types.Mount, tip_racks,
                 info,
                 **config_kwargs) -> None:
        self._ctx = ctx
        self._info = info
        self._mount = mount

    def aspirate(self,
                 volume: float = None,
                 location: Well = None,
                 rate: float = 1.0):
        pass

    def dispense(self,
                 volume: float = None,
                 location: Well = None,
                 rate: float = 1.0):
        pass

    def mix(self,
            repetitions: int = 1,
            volume: float = None,
            location: Well = None,
            rate: float = 1.0):
        pass

    def blow_out(self, location: Well = None):
        pass

    def touch_tip(self,
                  location: Well = None,
                  radius: float = 1.0,
                  v_offset: float = -1.0,
                  speed: float = 60.0):
        pass

    def air_gap(self,
                volume: float = None,
                height: float = None):
        pass

    def return_tip(self, home_after: bool = True):
        pass

    def pick_up_tip(self, location: Well = None,
                    presses: int = 3,
                    increment: int = 1):
        pass

    def drop_tip(self, location: Well = None,
                 home_after: bool = True):
        pass

    def home(self):
        """ Home the robot.

        :returns: This instance.
        """
        self._ctx.home()
        return self

    def distribute(self,
                   volume: float,
                   source: Well,
                   dest: Well,
                   *args, **kwargs):
        pass

    def consolidate(self,
                    volume: float,
                    source: Well,
                    dest: Well,
                    *args, **kwargs):
        pass

    def transfer(self,
                 volume: float,
                 source: Well,
                 dest: Well,
                 **kwargs):
        pass

    def move_to(self,
                location: geometry.Location,
                strategy: types.MotionStrategy = None):
        self._ctx.move_to(self._mount, location, strategy)
        return self

    @property
    def mount(self) -> str:
        return self._mount.name.lower()

    @property
    def speeds(self) -> Dict[MODE, float]:
        """ The speeds (in mm/s) configured for the pipette, as a dict.

        The keys will be 'aspirate' and 'dispense' (e.g. the keys of
        :py:class:`MODE`)

        :note: This property is equivalent to :py:attr:`speeds`; the only
        difference is the units in which this property is specified.
        """
        pass

    @speeds.setter
    def speeds(self, new_speeds: Dict[MODE, float]) -> None:
        """ Update the speeds (in mm/s) set for the pipette.

        :param new_speeds: A dict containing at least one of 'aspirate'
        and 'dispense',  mapping to new speeds in mm/s.
        """
        pass

    @property
    def flow_rate(self) -> Dict[MODE, float]:
        """ The speeds (in uL/s) configured for the pipette, as a dict.

        The  keys will be 'aspirate' and 'dispense'.

        :note: This property is equivalent to :py:attr:`speeds`; the only
        difference is the units in which this property is specified.
        """
        pass

    @flow_rate.setter
    def flow_rate(self, new_flow_rate: Dict[MODE, float]) -> None:
        """ Update the speeds (in uL/s) for the pipette.

        :param new_flow_rates: A dict containing at least one of 'aspirate
        and 'dispense', mapping to new speeds in uL/s.
        """
        pass

    @property
    def pick_up_current(self) -> float:
        """
        The current (amperes) the pipette mount's motor will use
        while picking up a tip. Specified in amps.
        """
        pass

    @pick_up_current.setter
    def pick_up_current(self, amps: float):
        """ Set the current used when picking up a tip.

        :param amps: The current, in amperes. Acceptable values: (0.0, 2.0)
        """
        pass

    @property
    def type(self) -> TYPE:
        """ One of :py:class:`TYPE`.
        """
        pass

    @property
    def tip_racks(self) -> List[Labware]:
        """ Query which tipracks have been linked to this PipetteContext"""
        pass

    @tip_racks.setter
    def tip_racks(self, racks: List[Labware]):
        pass

    @property
    def trash_container(self) -> Labware:
        """ The location the pipette will dispense trash to.
        """
        pass

    @trash_container.setter
    def trash_container(self, trash: Labware):
        pass

    @property
    def name(self):
        return self._info['name']
